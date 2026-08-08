import { useState } from "react";
import { Button, Card, Field, StatusLine, TextInput } from "../../components/ui";
import { ANGLES, NICHES, PLATFORMS } from "../../domain/hooklab/patterns";
import { offlineFill, unfilledSlots } from "../../domain/hooklab/offline";
import {
  evidenceLine,
  familyStats,
  selectPatterns,
  statusFor,
  type BadgeStatus,
  type ScoredPattern,
} from "../../domain/hooklab/underwrite";
import type { CompEntry, LedgerEntry } from "../../data/schemas/hooklab";
import { copyText } from "../../data/download";
import {
  AI_CALL,
  AI_LIMITS,
  attachCtas,
  attachHooks,
  buildAIPrompt,
  buildAngles,
  buildCtas,
  parseAIReply,
  readBrandVoice,
  readThinkingPref,
  type AngleSummary,
  type Candidate as AICandidate,
  type CtaSuggestion,
} from "../../domain/hooklab/ai";
import { mediumForPlatform } from "../../domain/hooklab/patterns";
import { generateText, withGeminiFallback, withJsonRetry } from "../../services/llm/provider";
import { hasProviderKey, resolveProviderConfig } from "../../services/llm/config";

/**
 * Badge copy. The wording is the product promise: "Proven for you" is only ever
 * shown when the user's own ledger backs it, and everything else says plainly
 * what it is instead of implying evidence it doesn't have.
 */
const BADGES: Record<BadgeStatus, { label: string; className: string }> = {
  proven: { label: "PROVEN FOR YOU", className: "bg-pos-ghost text-pos" },
  market: { label: "MARKET-PROVEN STRUCTURE", className: "bg-brand-ghost text-brand" },
  hypo: { label: "HYPOTHESIS", className: "bg-surface2 text-muted" },
  fatigued: { label: "FATIGUED", className: "bg-gold-ghost text-gold" },
};

interface Candidate {
  id: string;
  scored: ScoredPattern;
  text: string;
  status: BadgeStatus;
  /** Whether the model wrote this line, or a scaffold fill did. */
  mode: "ai" | "offline-fallback";
  /** What the wording was grounded in — shown so the claim is checkable. */
  grounding: string;
}

function HookCard({
  candidate,
  rank,
  topic,
  onLog,
}: {
  candidate: Candidate;
  rank: number;
  topic: string;
  onLog: (hook: string, patternId: string) => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const { scored, text, status, mode, grounding } = candidate;
  const badge = BADGES[status];
  const gaps = unfilledSlots(text);

  // Copying can genuinely fail — the async Clipboard API needs a secure
  // context. Say so rather than leaving a button that appears to do nothing.
  const copy = async (): Promise<void> => {
    const ok = await copyText(text);
    setCopyState(ok ? "done" : "failed");
    setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <li className="rounded-xl border border-edge bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-faint">#{rank}</span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] ${badge.className}`}>
          {badge.label}
        </span>
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
          {scored.pattern.name} · {scored.pattern.family} · {scored.pattern.tier}
        </span>
        {/* Which lines the model actually wrote. A scaffold fill dressed up as
            an AI draft would misrepresent where the wording came from. */}
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[0.08em] ${
            mode === "ai" ? "bg-brand-ghost text-brand" : "bg-surface2 text-faint"
          }`}
        >
          {mode === "ai" ? "AI DRAFT" : "SCAFFOLD FILL"}
        </span>
      </div>

      {/* Model output — rendered as a text node, never as HTML. */}
      <p className="text-[15px] leading-snug text-ink">{text}</p>

      <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-faint">
        GROUNDED IN {grounding.toUpperCase()}
      </p>

      {gaps.length > 0 && (
        // Say which slots are unfilled rather than shipping a line with visible
        // braces and letting the user wonder if it's broken.
        <p className="mt-2 text-xs text-gold">
          Fill in: {gaps.map((g) => g.replace(/_/g, " ")).join(", ")}
        </p>
      )}

      <p className="mt-2 text-xs leading-relaxed text-muted">{evidenceLine(scored, topic)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>
          {copyState === "done" ? "COPIED" : copyState === "failed" ? "COPY FAILED" : "COPY"}
        </Button>
        <Button onClick={() => onLog(text, scored.pattern.id)}>LOG OUTCOME</Button>
      </div>
    </li>
  );
}

export function GenerateView({
  ledger,
  comps,
  onLog,
}: {
  ledger: LedgerEntry[];
  comps: CompEntry[];
  onLog: (hook: string, patternId: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [sourceMaterial, setSourceMaterial] = useState("");
  const [niche, setNiche] = useState("general");
  const [platform, setPlatform] = useState("tiktok");
  const [goal, setGoal] = useState("views");
  const [angles, setAngles] = useState<string[]>([]);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [angleSummaries, setAngleSummaries] = useState<AngleSummary[]>([]);
  const [ctas, setCtas] = useState<CtaSuggestion[]>([]);
  const [tab, setTab] = useState<"hooks" | "angles" | "ctas">("hooks");
  const [busy, setBusy] = useState(false);
  /** What the provider is doing right now — a long call needs to say so. */
  const [phase, setPhase] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const toggleAngle = (id: string): void =>
    setAngles((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  /** Every candidate carries its own pattern, so provenance is never inferred. */
  const show = (list: AICandidate[]): void => {
    setResults(
      list.map((c) => ({
        id: c.id,
        scored: {
          pattern: c.pattern,
          score: c.score,
          winRate: c.winRate,
          fatigue: c.fatigue,
          personal: c.personal,
          ...(c.compMatch ? { compMatch: c.compMatch } : {}),
        },
        text: c.text,
        status: c.status,
        mode: c.mode,
        grounding: c.grounding,
      })),
    );
    setAngleSummaries(buildAngles(list));
    setTab("hooks");
  };

  /** The offline pass. Always available, and the fallback when AI fails. */
  const underwriteOffline = (): AICandidate[] => {
    const medium = mediumForPlatform(platform);
    return selectPatterns(ledger, niche, platform, angles).map((s) => ({
      id: s.pattern.id,
      text: offlineFill(s.pattern.scaffold, topic),
      pattern: s.pattern,
      medium,
      score: s.score,
      winRate: s.winRate,
      personal: s.personal,
      fatigue: s.fatigue,
      compMatch: null,
      grounding: "scaffold fill",
      status: statusFor(s),
      mode: "offline-fallback" as const,
    }));
  };

  const underwrite = async (): Promise<void> => {
    const cfg = resolveProviderConfig();
    const medium = mediumForPlatform(platform);
    // brandVoice comes from HOOKLAB's own settings blob, which migrating users
    // already have. Omitting it left prompt rule 3 permanently inert.
    const brief = { topic, sourceMaterial, niche, platform, goal, brandVoice: readBrandVoice() };
    // The CTA boost the legacy computes from the ledger's engagement family.
    const engagement = familyStats(ledger, medium).engagement;

    // No key means no AI — and that is a first-class path, not a degraded one.
    // Offline underwriting still ranks real patterns against the real ledger.
    // It still says so: every card reads SCAFFOLD FILL, and a user who thinks
    // they configured a key deserves to learn otherwise here rather than
    // wonder why the wording looks templated.
    if (!hasProviderKey(cfg)) {
      show(underwriteOffline());
      setCtas(buildCtas(topic, goal, medium, engagement));
      setNote({
        tone: "ok",
        text: "Underwritten offline — no API key set, so these are scaffold fills against your real ledger. Add a key in Settings for drafted wording.",
      });
      return;
    }

    setBusy(true);
    setNote(null);
    setPhase(null);
    try {
      const selected = selectPatterns(ledger, niche, platform, angles).slice(
        0,
        AI_LIMITS.patterns,
      );
      const thinking = readThinkingPref() === "on";
      const notices = { onPhase: setPhase };
      // Same wrapping as BLAST's suggestion call, and for the same reasons:
      // `partialOnTruncate` because HOOKLAB asks for 14 hooks plus 3 CTAs
      // against its own token cap — a long reply hits MAX_TOKENS and would
      // otherwise be discarded whole, even though attachHooks is built to
      // backfill a partial one. `withJsonRetry` because a reasoning model that
      // spends its budget monologuing usually recovers on the nudge.
      const parsed = await withGeminiFallback(
        cfg,
        (c) =>
          withJsonRetry(
            (nudge) =>
              generateText(c, {
                prompt: buildAIPrompt(brief, selected, ledger, comps) + nudge,
                temperature: AI_CALL.temperature,
                jsonMode: true,
                partialOnTruncate: true,
                thinkingBudget: thinking ? AI_CALL.thinkingBudget : 0,
                maxTokens: thinking ? AI_CALL.maxTokensThinking : AI_CALL.maxTokens,
                onPhase: setPhase,
              }).then(parseAIReply),
            notices,
          ),
        notices,
      );
      const drafted = attachHooks(parsed, selected, topic, medium, comps, sourceMaterial, () =>
        `h_${Math.random().toString(36).slice(2, 9)}`,
      );
      show(drafted);
      setCtas(attachCtas(parsed, topic, goal, medium, engagement));

      // A call that succeeded but produced nothing usable looks exactly like
      // an offline run, and silence would let it pass for one. This happens
      // when the model paraphrases pattern ids past what the name match
      // catches — every hook is then correctly dropped.
      const kept = drafted.filter((c) => c.mode === "ai").length;
      const asked = parsed.hooks?.length ?? 0;
      if (kept === 0 && asked > 0) {
        setNote({
          tone: "error",
          text: `The model returned ${asked} hook${asked === 1 ? "" : "s"}, but none named a pattern from the brief — they were dropped rather than shown with borrowed provenance. These are scaffold fills.`,
        });
      } else if (kept < asked) {
        setNote({
          tone: "ok",
          text: `${asked - kept} of ${asked} returned hooks named no pattern from the brief and were dropped. The rest are drafted.`,
        });
      }
    } catch (e) {
      // Falling back is the right answer, but saying so matters: silently
      // showing scaffold fills would look like the AI wrote them.
      show(underwriteOffline());
      setCtas(buildCtas(topic, goal, medium, engagement));
      setNote({
        tone: "error",
        text: `${e instanceof Error ? e.message : "AI failed"} — showing offline scaffold fills instead.`,
      });
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const selectCls =
    "w-full rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink";

  return (
    <>
      <Card title="BRIEF" hint="Underwrites from your ledger first, then market structure.">
        <Field label="Topic" hint="What the hook is about — fills the {topic} slots.">
          <TextInput value={topic} onChange={setTopic} placeholder="e.g. why most hooks fail" />
        </Field>

        <Field
          label="Source material"
          hint="Optional — a transcript or notes. Grounds the wording in something real instead of the topic alone."
        >
          <textarea
            value={sourceMaterial}
            onChange={(e) => setSourceMaterial(e.target.value)}
            rows={3}
            placeholder="Paste the transcript, or the notes the clip came from."
            className="w-full rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Niche">
            <select value={niche} onChange={(e) => setNiche(e.target.value)} className={selectCls}>
              {NICHES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Platform" hint="Decides medium — text and video use different scaffolds.">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className={selectCls}
            >
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Goal" hint="Nudges which CTAs get suggested.">
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className={selectCls}>
            {[
              { id: "views", label: "Views" },
              { id: "comments", label: "Comments" },
              { id: "saves", label: "Saves" },
              { id: "series", label: "Follows / series" },
            ].map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Angles" hint="Optional — narrows to the families these angles use.">
          <div className="flex flex-wrap gap-2">
            {ANGLES.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={angles.includes(a.id)}
                onClick={() => toggleAngle(a.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  angles.includes(a.id)
                    ? "border-brand bg-brand-ghost text-brand"
                    : "border-edge text-muted hover:text-ink"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        </Field>

        <Button onClick={() => void underwrite()} variant="primary" disabled={busy}>
          {busy ? (phase ?? "UNDERWRITING…") : "UNDERWRITE HOOKS"}
        </Button>
        {note && <StatusLine tone={note.tone}>{note.text}</StatusLine>}
      </Card>

      {results === null && (
        <Card
          title="NOTHING UNDERWRITTEN YET"
          hint="HOOKLAB ranks patterns against your own ledger, not against a vibe."
        >
          <p className="text-sm text-muted">
            Describe the topic and hit UNDERWRITE HOOKS. Every result shows the pattern behind it
            and what your own numbers say about that pattern — a real win rate when you have one,
            and an honest &ldquo;no history yet&rdquo; when you don&rsquo;t.
          </p>
        </Card>
      )}

      {results !== null && results.length === 0 && (
        <Card title="NO PATTERNS FIT" hint="Nothing matched, and inventing one would be worse.">
          <p className="text-sm text-muted">
            No pattern in the bank fits that platform and angle combination. Widen the angle, or
            pick a different platform — the bank is medium-filtered, so a text platform and a
            video-only angle can genuinely leave nothing.
          </p>
        </Card>
      )}

      {results !== null && results.length > 0 && (
        <Card
          title={`RESULTS — ${results.length} RANKED`}
          hint="Every card names the pattern behind it and what your ledger says about that pattern."
        >
          <div className="mb-4 flex gap-1">
            {(
              [
                ["hooks", `HOOKS ${results.length}`],
                ["angles", `ANGLES ${angleSummaries.length}`],
                ["ctas", `CTAS ${ctas.length}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`rounded-lg border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.08em] transition ${
                  tab === id ? "border-brand bg-surface2 text-brand" : "border-edge text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "hooks" && (
            <ul className="space-y-3">
              {results.map((c, i) => (
                <HookCard
                  // Keyed on the candidate, not its rank: a card that showed
                  // COPIED would otherwise keep showing it when the next run
                  // put a different hook at the same position.
                  key={c.id}
                  candidate={c}
                  rank={i + 1}
                  topic={topic}
                  onLog={onLog}
                />
              ))}
            </ul>
          )}

          {tab === "angles" && (
            <ul className="space-y-3">
              {angleSummaries.map((a) => (
                <li key={a.id} className="rounded-lg border border-edge bg-surface2 p-3">
                  <p className="text-sm text-ink">{a.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{a.description}</p>
                  <p className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-faint">
                    {a.count} CANDIDATE{a.count === 1 ? "" : "S"}
                  </p>
                  {a.sample && <p className="mt-1.5 text-sm text-ink">{a.sample}</p>}
                </li>
              ))}
            </ul>
          )}

          {tab === "ctas" && (
            <ul className="space-y-3">
              {ctas.map((c) => (
                <li key={c.id} className="rounded-lg border border-edge bg-surface2 p-3">
                  <p className="text-sm text-ink">{c.text}</p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-faint">
                    {c.name.toUpperCase()} · {c.why}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

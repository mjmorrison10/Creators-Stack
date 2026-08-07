import { useState } from "react";
import { Button, Card, Field, TextInput } from "../../components/ui";
import { ANGLES, NICHES, PLATFORMS } from "../../domain/hooklab/patterns";
import { offlineFill, unfilledSlots } from "../../domain/hooklab/offline";
import {
  evidenceLine,
  selectPatterns,
  statusFor,
  type BadgeStatus,
  type ScoredPattern,
} from "../../domain/hooklab/underwrite";
import type { LedgerEntry } from "../../data/schemas/hooklab";

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
  scored: ScoredPattern;
  text: string;
  status: BadgeStatus;
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
  const [copied, setCopied] = useState(false);
  const { scored, text, status } = candidate;
  const badge = BADGES[status];
  const gaps = unfilledSlots(text);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
      </div>

      <p className="text-[15px] leading-snug text-ink">{text}</p>

      {gaps.length > 0 && (
        // Say which slots are unfilled rather than shipping a line with visible
        // braces and letting the user wonder if it's broken.
        <p className="mt-2 text-xs text-gold">
          Fill in: {gaps.map((g) => g.replace(/_/g, " ")).join(", ")}
        </p>
      )}

      <p className="mt-2 text-xs leading-relaxed text-muted">{evidenceLine(scored, topic)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>{copied ? "COPIED" : "COPY"}</Button>
        <Button onClick={() => onLog(text, scored.pattern.id)}>LOG OUTCOME</Button>
      </div>
    </li>
  );
}

export function GenerateView({
  ledger,
  onLog,
}: {
  ledger: LedgerEntry[];
  onLog: (hook: string, patternId: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState("general");
  const [platform, setPlatform] = useState("tiktok");
  const [angles, setAngles] = useState<string[]>([]);
  const [results, setResults] = useState<Candidate[] | null>(null);

  const toggleAngle = (id: string): void =>
    setAngles((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const underwrite = (): void => {
    const scored = selectPatterns(ledger, niche, platform, angles);
    setResults(
      scored.map((s) => ({
        scored: s,
        text: offlineFill(s.pattern.scaffold, topic),
        status: statusFor(s),
      })),
    );
  };

  const selectCls =
    "w-full rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink";

  return (
    <>
      <Card title="BRIEF" hint="Underwrites from your ledger first, then market structure.">
        <Field label="Topic" hint="What the hook is about — fills the {topic} slots.">
          <TextInput value={topic} onChange={setTopic} placeholder="e.g. why most hooks fail" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Niche">
            <select value={niche} onChange={(e) => setNiche(e.target.value)} className={selectCls}>
              <option value="general">General</option>
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

        <Button onClick={underwrite} variant="primary">
          UNDERWRITE HOOKS
        </Button>
      </Card>

      {results && (
        <Card
          title={`RESULTS — ${results.length} RANKED`}
          hint="Offline underwriting: real patterns, deterministic slot fills. AI drafting arrives with the BLAST section."
        >
          <ul className="space-y-3">
            {results.map((c, i) => (
              <HookCard
                key={c.scored.pattern.id}
                candidate={c}
                rank={i + 1}
                topic={topic}
                onLog={onLog}
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

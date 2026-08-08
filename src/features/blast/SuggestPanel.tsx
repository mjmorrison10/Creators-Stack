import { useState } from "react";
import { Button, Card, Field, StatusLine, TextInput } from "../../components/ui";
import { generateText, withGeminiFallback, withJsonRetry } from "../../services/llm/provider";
import { hasProviderKey, providerLabel, resolveProviderConfig } from "../../services/llm/config";
import type { LengthPref } from "../../domain/blast/platforms";
import {
  captionSuggestPrompt,
  clipContextBlock,
  hooklabEvidenceBlock,
  isPartial,
  loadHooklabEvidence,
  normalizeOptions,
  parseCaptionJSON,
  readLengthPref,
  writeLengthPref,
  type CaptionResponse,
} from "../../domain/blast/suggest";
import type { BlastPost, SuggestionOption } from "../../domain/blast/queue";

const LENGTHS: { id: LengthPref; label: string }[] = [
  { id: "short", label: "SHORT" },
  { id: "medium", label: "MEDIUM" },
  { id: "long", label: "LONG" },
];

/** What to say when the ledger can't personalize anything yet. */
const EVIDENCE_NOTE: Record<string, string> = {
  ok: "",
  absent: "No HOOKLAB ledger here yet — suggestions will be generic until you log a winner.",
  empty: "Your HOOKLAB ledger is empty — suggestions will be generic until you log a winner.",
  "no-winners":
    "Nothing in your ledger is marked a winner yet — mark one and suggestions lean on your proven openers.",
};

/**
 * Caption suggestions for the platforms this clip is going to.
 *
 * The creator's own winning hooks go into the prompt when they exist, because
 * personal evidence beats generic advice — and when they don't, the prompt says
 * nothing rather than implying a track record that isn't there.
 */
export function SuggestPanel({
  post,
  names,
  onApply,
}: {
  post: BlastPost;
  names: string[];
  onApply: (suggestions: Record<string, SuggestionOption[]>) => void;
}) {
  const [count, setCount] = useState(3);
  const [pref, setPref] = useState<LengthPref>(() => readLengthPref());
  const [context, setContext] = useState("");
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const evidence = loadHooklabEvidence();
  const cfg = resolveProviderConfig();
  const seed = post.text.trim() || post.hookText.trim();

  const setLength = (v: LengthPref): void => {
    setPref(v);
    writeLengthPref(v);
  };

  const run = async (): Promise<void> => {
    setError(null);
    setNote(null);
    if (!seed) {
      setError("Write a base caption or a video hook first — there's nothing to work from.");
      return;
    }
    if (!hasProviderKey(cfg)) {
      setError(`Suggestions need an API key. Add one in Settings — ${providerLabel(cfg)} is selected.`);
      return;
    }

    setPhase("Asking " + providerLabel(cfg) + "…");
    try {
      const prompt =
        "Here is a short-form video clip's caption seed:\n\n" +
        seed +
        clipContextBlock(context) +
        "\n\n" +
        captionSuggestPrompt(names, count, pref) +
        hooklabEvidenceBlock(evidence);

      const result = await withGeminiFallback(cfg, (active) =>
        withJsonRetry(async (nudge) => {
          const text = await generateText(active, {
            prompt: prompt + nudge,
            jsonMode: true,
            temperature: 0.5,
            partialOnTruncate: true,
            onPhase: (p: string) => setPhase(p),
          });
          return parseCaptionJSON(text);
        }),
      );

      applyResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestions failed.");
    } finally {
      setPhase(null);
    }
  };

  const applyResult = (result: CaptionResponse): void => {
    // Options are passed through in the shape the queue stores — Pinterest's
    // stay {title, description} objects, because that is what the still-
    // deployed legacy BLAST reads back.
    const out: Record<string, SuggestionOption[]> = {};
    for (const n of names) {
      const opts = normalizeOptions(n, result[n], count);
      if (opts.length) out[n] = opts;
    }
    if (!Object.keys(out).length) {
      setError("The model didn't return captions for any of the selected platforms.");
      return;
    }
    onApply(out);
    const missing = names.filter((n) => !out[n]);
    if (isPartial(result) || missing.length) {
      // Say what didn't arrive rather than quietly showing fewer platforms.
      setNote(
        `Got captions for ${Object.keys(out).length} of ${names.length} platforms — the reply was cut short${
          missing.length ? `. Missing: ${missing.join(", ")}` : "."
        }`,
      );
    } else {
      setNote(`Suggestions ready for ${Object.keys(out).length} platforms.`);
    }
  };

  return (
    <Card
      title="SUGGEST CAPTIONS"
      hint="Grounded in this clip. Your proven hooks steer the voice when you have them."
    >
      {evidence.reason !== "ok" ? (
        <p className="mb-4 text-sm text-muted">{EVIDENCE_NOTE[evidence.reason]}</p>
      ) : (
        <p className="mb-4 text-sm text-muted">
          Leaning on {evidence.winners.length} winning hook
          {evidence.winners.length === 1 ? "" : "s"} from your HOOKLAB ledger.
        </p>
      )}

      <Field label="What's this clip really about?" hint="Optional — frames the angle and tone.">
        <TextInput
          value={context}
          onChange={setContext}
          placeholder="e.g. it's about burnout, not hustle"
        />
      </Field>

      <div className="mb-4 flex flex-wrap gap-4">
        <div>
          <p className="mb-1.5 font-mono text-[10px] tracking-[0.14em] text-faint">LENGTH</p>
          <div className="flex gap-2">
            {LENGTHS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLength(l.id)}
                aria-pressed={pref === l.id}
                className={`rounded-lg border px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.08em] transition ${
                  pref === l.id ? "border-blast bg-surface2 text-blast" : "border-edge text-muted"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 font-mono text-[10px] tracking-[0.14em] text-faint">OPTIONS EACH</p>
          <div className="flex gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                aria-pressed={count === n}
                className={`rounded-lg border px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.08em] transition ${
                  count === n ? "border-blast bg-surface2 text-blast" : "border-edge text-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Button onClick={() => void run()} variant="primary" disabled={Boolean(phase)}>
        {phase ? "WORKING…" : `SUGGEST FOR ${names.length} PLATFORMS`}
      </Button>

      {phase && <StatusLine tone="info">{phase}</StatusLine>}
      {error && <StatusLine tone="error">{error}</StatusLine>}
      {note && !error && <StatusLine tone="ok">{note}</StatusLine>}
    </Card>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, StatusLine, TextInput } from "../../components/ui";
import { NICHES, PATTERNS, PLATFORMS } from "../../domain/hooklab/patterns";
import { insightRows, MIN_INSIGHT_SAMPLE } from "../../domain/hooklab/underwrite";
import { buildExport, isAutoPromoted, EXPORT_FILENAME } from "../../domain/hooklab/ledger";
import type { HooklabState, LedgerEntry, Outcome } from "../../data/schemas/hooklab";
import type { LedgerFields } from "../../domain/hooklab/ledger";
import { downloadJson } from "../../data/download";

const OUTCOME_LABEL: Record<Outcome, { label: string; className: string }> = {
  winner: { label: "WINNER", className: "text-pos" },
  meh: { label: "MEH", className: "text-muted" },
  dead: { label: "DEAD", className: "text-gold" },
};

/**
 * Win-rate tables. Groups under the sample threshold are omitted by
 * `insightRows`, and the n is always rendered — the product rule is that a
 * percentage is never shown unless it was actually measured.
 */
function Insights({ ledger }: { ledger: LedgerEntry[] }) {
  const tables: { title: string; rows: ReturnType<typeof insightRows> }[] = [
    { title: "By platform", rows: insightRows(ledger, (e) => e.platform) },
    { title: "By family", rows: insightRows(ledger, (e) => e.family) },
    { title: "By hypothesis", rows: insightRows(ledger, (e) => e.hypothesis) },
  ].filter((t) => t.rows.length > 0);

  if (!tables.length) {
    return (
      <p className="text-sm text-muted">
        No group has {MIN_INSIGHT_SAMPLE} entries yet. Rates appear once there is enough to
        report honestly.
      </p>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {tables.map((t) => (
        <div key={t.title}>
          <h3 className="mb-2 font-mono text-[10px] tracking-[0.14em] text-faint">
            {t.title.toUpperCase()}
          </h3>
          <ul className="space-y-1.5">
            {t.rows.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">{r.key}</span>
                <span className="text-muted">
                  {Math.round(r.winRate * 100)}%{" "}
                  <span className="text-faint">(n={r.total})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface FormState {
  hook: string;
  patternId: string;
  outcome: Outcome;
  platform: string;
  niche: string;
  views: string;
  notes: string;
}

const BLANK: FormState = {
  hook: "",
  patternId: "",
  outcome: "winner",
  platform: "tiktok",
  niche: "general",
  views: "",
  notes: "",
};

/** Tone travels with the message — sniffing the text for "isn't" mislabelled
 *  the validation error as success. */
type Status = { tone: "ok" | "error"; text: string };

export function LedgerView({
  state,
  prefill,
  onPrefillConsumed,
  onLog,
  onRemove,
  onImport,
}: {
  state: HooklabState;
  prefill?: { hook: string; patternId: string } | null;
  onPrefillConsumed?: () => void;
  onLog: (fields: Partial<LedgerFields> & { hook: string }) => void;
  onRemove: (id: string) => void;
  onImport: (data: unknown) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    prefill ? { ...BLANK, hook: prefill.hook, patternId: prefill.patternId } : BLANK,
  );
  const [status, setStatus] = useState<Status | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Tell the parent the prefill has been used, so revisiting this tab starts blank.
  useEffect(() => {
    if (prefill) onPrefillConsumed?.();
    // Deliberately once per mount: the form owns the values from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]): void =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = (): void => {
    if (!form.hook.trim()) {
      setStatus({ tone: "error", text: "Hook text is required." });
      return;
    }
    onLog({ ...form, hook: form.hook.trim() });
    setForm(BLANK);
    setStatus({ tone: "ok", text: "Logged." });
  };

  const doImport = (file: File | undefined): void => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        onImport(JSON.parse(String(r.result)));
        setStatus({ tone: "ok", text: "Imported." });
      } catch {
        setStatus({ tone: "error", text: "That file isn't valid JSON." });
      }
    };
    r.onerror = () => setStatus({ tone: "error", text: "Couldn't read that file." });
    r.readAsText(file);
  };

  const wins = state.ledger.filter((e) => e.outcome === "winner").length;
  const selectCls = "w-full rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink";

  return (
    <>
      <Card title="LOG AN OUTCOME" hint="Every entry sharpens what the GENERATE tab recommends.">
        <Field label="Hook">
          <TextInput value={form.hook} onChange={(v) => set("hook", v)} placeholder="The opening line you used" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pattern" hint="Sets the family the scoring groups on.">
            <select
              value={form.patternId}
              onChange={(e) => set("patternId", e.target.value)}
              className={selectCls}
            >
              <option value="">— none —</option>
              {PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Outcome">
            <select
              value={form.outcome}
              onChange={(e) => set("outcome", e.target.value as Outcome)}
              className={selectCls}
            >
              <option value="winner">Winner</option>
              <option value="meh">Meh</option>
              <option value="dead">Dead</option>
            </select>
          </Field>
          <Field label="Platform">
            <select
              value={form.platform}
              onChange={(e) => set("platform", e.target.value)}
              className={selectCls}
            >
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Niche">
            <select
              value={form.niche}
              onChange={(e) => set("niche", e.target.value)}
              className={selectCls}
            >
              {NICHES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Views" hint="Optional.">
          <TextInput value={form.views} onChange={(v) => set("views", v)} />
        </Field>
        <Field label="Notes" hint="Optional — why you think it worked.">
          <TextInput value={form.notes} onChange={(v) => set("notes", v)} />
        </Field>
        <Button onClick={submit} variant="primary">
          LOG ENTRY
        </Button>
        {status && <StatusLine tone={status.tone}>{status.text}</StatusLine>}
      </Card>

      <Card title="INSIGHTS" hint={`Only groups with ${MIN_INSIGHT_SAMPLE}+ entries are reported, and n is always shown.`}>
        <Insights ledger={state.ledger} />
      </Card>

      <Card
        title={`LEDGER — ${state.ledger.length} ENTRIES, ${wins} WINNERS`}
        hint="Newest first. Entries PULSE promoted automatically are marked AUTO."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <Button onClick={() => downloadJson(buildExport(state), EXPORT_FILENAME)}>EXPORT</Button>
          <Button onClick={() => fileInput.current?.click()}>IMPORT</Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              doImport(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        {state.ledger.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing logged yet. Until there is, hooks are ranked as market structure rather than
            proven for you.
          </p>
        ) : (
          <ul className="space-y-2">
            {state.ledger.map((e) => {
              const oc = OUTCOME_LABEL[e.outcome] ?? OUTCOME_LABEL.meh;
              return (
                <li
                  key={e.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-edge bg-surface2 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{e.hook}</p>
                    <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-faint">
                      <span className={oc.className}>{oc.label}</span>
                      {e.family && ` · ${e.family}`}
                      {e.platform && ` · ${e.platform}`}
                      {isAutoPromoted(e) && (
                        <span className="ml-1 rounded bg-brand-ghost px-1.5 py-0.5 text-brand">
                          AUTO
                        </span>
                      )}
                    </p>
                  </div>
                  <Button onClick={() => onRemove(e.id)}>DELETE</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

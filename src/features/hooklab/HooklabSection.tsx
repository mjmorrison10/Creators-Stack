import { useState } from "react";
import { SectionHeader } from "../../components/SectionHeader";
import { SECTIONS } from "../../sections";
import { useHooklab } from "./useHooklab";
import { GenerateView } from "./GenerateView";
import { LedgerView } from "./LedgerView";
import { BankView } from "./BankView";

const meta = SECTIONS[1]!;

type Tab = "generate" | "ledger" | "bank";

const TABS: { id: Tab; label: string }[] = [
  { id: "generate", label: "GENERATE" },
  { id: "ledger", label: "LEDGER" },
  { id: "bank", label: "BANK" },
];

export function HooklabSection() {
  const [tab, setTab] = useState<Tab>("generate");
  const [prefill, setPrefill] = useState<{ hook: string; patternId: string } | null>(null);
  const { state, logEntry, removeEntry, importData } = useHooklab();

  // "Log outcome" on a generated hook carries it into the ledger form, so the
  // loop from recommendation to recorded evidence is one click.
  const logFromGenerate = (hook: string, patternId: string): void => {
    setPrefill({ hook, patternId });
    setTab("ledger");
  };

  return (
    <>
      <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />

      <div role="tablist" aria-label="HookLab views" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg border px-3 py-2 font-mono text-[11px] font-bold tracking-[0.08em] transition ${
              tab === t.id
                ? "border-hooklab bg-surface2 text-hooklab"
                : "border-edge text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.id === "ledger" && state.ledger.length > 0 && (
              <span className="ml-1.5 text-faint">{state.ledger.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "generate" && <GenerateView ledger={state.ledger} comps={state.comps} onLog={logFromGenerate} />}
      {tab === "ledger" && (
        <LedgerView
          state={state}
          // No `key` tied to the prefill: LOG OUTCOME only exists on GENERATE,
          // so this view is always unmounted when a prefill arrives and its
          // initializer picks the values up. Keying on the hook meant clearing
          // the prefill remounted the form and wiped the seeded hook.
          prefill={prefill}
          // LedgerView unmounts whenever another tab is active, so an
          // uncleared prefill would re-seed the form on every later visit and
          // invite an accidental duplicate entry. One-shot: consume and clear.
          onPrefillConsumed={() => setPrefill(null)}
          onLog={logEntry}
          onRemove={removeEntry}
          onImport={importData}
        />
      )}
      {tab === "bank" && <BankView />}
    </>
  );
}

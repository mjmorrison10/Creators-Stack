import { useState } from "react";
import { SectionHeader } from "../../components/SectionHeader";
import { SECTIONS } from "../../sections";
import { useHooklab } from "./useHooklab";
import { GenerateView } from "./GenerateView";
import { LedgerView } from "./LedgerView";
import { BankView } from "./BankView";
import { Tabs, TabPanel } from "../../components/Tabs";

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

      <Tabs
        label="HookLab views"
        tabs={TABS.map((t) =>
          t.id === "ledger" && state.ledger.length > 0
            ? { ...t, badge: state.ledger.length }
            : t,
        )}
        active={tab}
        onChange={setTab}
        accentClass="border-hooklab text-hooklab"
      />

      {/* GENERATE stays mounted across tab switches. Unmounting it abandoned
          an in-flight AI call — thinking is on by default, so the wait is long
          enough that checking the ledger mid-generation is a normal thing to
          do — and the user came back to the pre-generation empty state with no
          sign the request had ever happened. `hidden` keeps it out of the
          accessibility tree while preserving its state.

          The other two are still conditional: LedgerView's one-shot prefill
          relies on being remounted to pick it up. That is also why this panel
          spells out the tabpanel wiring instead of using TabPanel, which
          unmounts when inactive. */}
      <div
        role="tabpanel"
        id="panel-HookLab views-generate"
        aria-labelledby="tab-HookLab views-generate"
        tabIndex={0}
        hidden={tab !== "generate"}
        className="outline-none"
      >
        <GenerateView ledger={state.ledger} comps={state.comps} onLog={logFromGenerate} />
      </div>
      <TabPanel id="ledger" label="HookLab views" active={tab === "ledger"}>
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
      </TabPanel>
      <TabPanel id="bank" label="HookLab views" active={tab === "bank"}>
        <BankView />
      </TabPanel>
    </>
  );
}

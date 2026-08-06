import { SectionHeader, ComingInPhase } from "../../components/SectionHeader";
import { SECTIONS } from "../../sections";

const meta = SECTIONS[1]!;

export function HooklabSection() {
  return (
    <>
      <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />
      <ComingInPhase
        phase={3}
        items={[
          "GENERATE — underwritten hooks with provenance badges",
          "LEDGER — outcomes log and insights (n ≥ 3 only, n always shown)",
          "BANK — pattern browser, comps, historical instances",
          "Ledger export / import",
        ]}
      />
    </>
  );
}

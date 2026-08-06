import { SectionHeader, ComingInPhase } from "../../components/SectionHeader";
import { SECTIONS } from "../../sections";

const meta = SECTIONS[3]!;

export function PulseSection() {
  return (
    <>
      <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />
      <ComingInPhase
        phase={6}
        items={[
          "Import posted clips from BLAST, or add manually",
          "By-clip and by-platform views with sparklines",
          "YouTube auto-stats on the checkpoint schedule",
          "Outcome marking and auto-promotion into the HOOKLAB ledger",
        ]}
      />
    </>
  );
}

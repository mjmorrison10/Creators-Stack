import { SectionHeader, ComingInPhase } from "../../components/SectionHeader";
import { SECTIONS } from "../../sections";

const meta = SECTIONS[0]!;

export function RecallSection() {
  return (
    <>
      <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />
      <ComingInPhase
        phase={4}
        items={[
          "Transcript parsing (SRT / VTT / TurboScribe / bare timestamps)",
          "Source library in IndexedDB, search, source chips",
          "Clip bin, SRT + shot-list export",
          "AI transcription of uploaded audio and video",
          "TOP CLIPS scan with PROOF scoring and optional AI pass",
        ]}
      />
    </>
  );
}

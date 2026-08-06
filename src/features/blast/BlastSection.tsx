import { SectionHeader, ComingInPhase } from "../../components/SectionHeader";
import { SECTIONS } from "../../sections";

const meta = SECTIONS[2]!;

export function BlastSection() {
  return (
    <>
      <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />
      <ComingInPhase
        phase={5}
        items={[
          "Clip queue with per-platform caption editor and limits",
          "AI caption suggestions grounded in HOOKLAB winners",
          "Presets, forward-only status machine, web intents",
          "9:16 reformat via ffmpeg.wasm",
        ]}
      />
    </>
  );
}

import { SectionHeader, ComingInPhase } from "../../components/SectionHeader";

export function SettingsSection() {
  return (
    <>
      <SectionHeader
        name="SETTINGS"
        tagline="Keys, backup, and Google Drive sync for the whole stack."
        accent="text-ink"
      />
      <ComingInPhase
        phase={2}
        items={[
          "Shared API keys (stack_settings_v1) — never leave the device",
          "Backup and restore for all four legacy export envelopes",
          "Google Drive sync with the workspace guard",
          "Theme and AI model picker",
        ]}
      />
    </>
  );
}

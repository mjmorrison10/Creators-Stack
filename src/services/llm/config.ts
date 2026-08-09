/**
 * Resolving which provider to call, and with what key.
 *
 * Keys come from the shared store (`stack_settings_v1`), which is the whole
 * point of that store: one key entered anywhere works everywhere. The provider
 * *preference* was per-app in the legacy stack — `recall_settings_v1.provider`,
 * `hooklab_settings_v1.provider`, and so on — and those blobs are still read so
 * a user's existing choice carries over, with the first one found winning.
 *
 * Nothing here writes a key anywhere. `stack_settings_v1` is in SYNC_EXCLUDE,
 * so these values never leave the device.
 */

import { KEYS } from "../../data/keys";
import { readJSON } from "../../data/storage";
import { readSharedKeys } from "../../data/stackdata/shared";
import type { ProviderConfig, ProviderName } from "./provider";

/** Legacy per-app settings blobs, in the order their preference is honored. */
const PROVIDER_KEYS = [
  KEYS.recallSettings,
  KEYS.hooklabSettings,
  KEYS.blastSettings,
] as const;

function storedProvider(): ProviderName {
  for (const key of PROVIDER_KEYS) {
    const v = readJSON<{ provider?: string }>(key, {});
    if (v?.provider === "gemini" || v?.provider === "openrouter") return v.provider;
  }
  return "gemini";
}

/**
 * The config every AI call in the app goes through.
 *
 * If the stored preference has no key but the other provider does, the one with
 * a key is used. A user who pasted an OpenRouter key and never touched a
 * provider radio should get a working app, not "No Gemini API key".
 */
export function resolveProviderConfig(): ProviderConfig {
  const keys = readSharedKeys();
  const geminiKey = (keys.geminiKey as string) || "";
  const openrouterKey = (keys.openrouterKey as string) || "";
  const openrouterModel = (keys.openrouterModel as string) || "";

  let provider = storedProvider();
  if (provider === "gemini" && !geminiKey && openrouterKey) provider = "openrouter";
  else if (provider === "openrouter" && !openrouterKey && geminiKey) provider = "gemini";

  return { provider, geminiKey, openrouterKey, openrouterModel };
}

/** Whether an AI action can run at all, so the UI can say so before trying. */
export function hasProviderKey(cfg: ProviderConfig = resolveProviderConfig()): boolean {
  return cfg.provider === "gemini" ? Boolean(cfg.geminiKey) : Boolean(cfg.openrouterKey);
}

export function providerLabel(cfg: ProviderConfig = resolveProviderConfig()): string {
  return cfg.provider === "gemini" ? "Gemini" : "OpenRouter";
}

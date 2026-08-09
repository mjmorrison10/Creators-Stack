/**
 * Caption presets and where "copy + open" actually sends the user.
 * Ported from blast/app.js.
 *
 * Presets live in `blast_presets_v1`, separate from the session and the queue,
 * because a caption template is a durable per-creator habit rather than part of
 * one posting session — they survive Reset deliberately.
 */

import { KEYS } from "../../data/keys";
import { readJSON, writeJSON } from "../../data/storage";
import { platformByName, type Platform } from "./platforms";

export type Presets = Record<string, string>;

export function readPresets(): Presets {
  const v = readJSON<Presets>(KEYS.blastPresets, {});
  return v && typeof v === "object" ? v : {};
}

export function writePresets(p: Presets): void {
  writeJSON(KEYS.blastPresets, p);
}

/** Blank clears the preset rather than storing an empty template. */
export function setPreset(presets: Presets, name: string, template: string): Presets {
  const next = { ...presets };
  const v = template.trim();
  if (v) next[name] = template;
  else delete next[name];
  return next;
}

/**
 * Substitute the base caption into a template.
 *
 * split/join, not `.replace`: a `$` in the caption would otherwise be read as a
 * replacement pattern (`$&` re-inserting the match, `$'` the tail), and a
 * regex-less `.replace` only substitutes the FIRST `{caption}`. Both matter —
 * creators write "$$$" in captions and put the token in twice.
 */
export function applyTemplate(template: string, base: string): string {
  return String(template).split("{caption}").join(base);
}

// ── where "copy + open" goes ────────────────────────────────────────────

/**
 * X and Threads accept a prefilled `?text=`, so copy-and-open can land the user
 * in a compose window with the caption already there. Everything else only has
 * an upload page and keeps the plain URL. The clipboard copy happens first
 * either way, so it is always the backup.
 */
const INTENT_URLS: Record<string, (t: string) => string> = {
  X: (t) => "https://x.com/intent/post?text=" + encodeURIComponent(t),
  Threads: (t) => "https://www.threads.net/intent/post?text=" + encodeURIComponent(t),
};

/** Encoded chars. Both platforms' caption limits fit well under this. */
export const INTENT_URL_MAX = 2000;

/**
 * On a phone two web URLs misbehave inside the platform's in-app browser: X's
 * web intent gets hijacked by the X app into an in-app browser that then
 * freezes, and TikTok's web upload page is useless without a desktop login. For
 * those two, launch the native app instead. Everything else keeps its https URL
 * on every device — and since the clipboard copy already happened, an app that
 * isn't installed just does nothing while the caption is safely saved.
 */
const SCHEME_URLS: Record<string, (t: string) => string> = {
  X: (t) => "twitter://post?message=" + encodeURIComponent(t),
  // TikTok has no public upload deep link; snssdk1233:// just foregrounds the
  // app (1233 is its iOS app id). If this ever no-ops, try tiktok://.
  TikTok: () => "snssdk1233://",
};

export const MOBILE_UA_RE = /iPhone|iPad|iPod|Android/i;

export function isMobile(ua: string = navigator.userAgent): boolean {
  return MOBILE_UA_RE.test(ua);
}

export interface NavTarget {
  url: string;
  /**
   * "scheme" launches a native app via location.href — the reliable iOS
   * pattern, since window.open on a custom scheme leaves a blank or
   * popup-blocked tab. "tab" opens a web URL in a new tab.
   */
  mode: "scheme" | "tab";
}

/** Where copy-and-open should send the user for this platform and caption. */
export function navTarget(
  platform: Platform | string,
  text: string,
  mobile: boolean = isMobile(),
): NavTarget {
  const p = typeof platform === "string" ? platformByName(platform) : platform;
  if (!p) return { url: "", mode: "tab" };

  if (mobile && SCHEME_URLS[p.name]) {
    const u = SCHEME_URLS[p.name]!(text);
    // Too long to be safe: fall back to the bare scheme, which just opens the app.
    return { url: u.length <= INTENT_URL_MAX ? u : u.split("?")[0]!, mode: "scheme" };
  }

  const build = INTENT_URLS[p.name];
  if (!build) return { url: p.url, mode: "tab" };
  const w = build(text);
  // Absurdly long → the plain upload page; the caption is already on the
  // clipboard, and a truncated intent would be worse than none.
  return { url: w.length <= INTENT_URL_MAX ? w : p.url, mode: "tab" };
}

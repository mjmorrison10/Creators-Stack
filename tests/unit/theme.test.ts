import { describe, it, expect, beforeEach } from "vitest";
import { applyTheme, seedThemeFromLegacy } from "../../src/features/settings/ThemeControl";
import { KEYS } from "../../src/data/keys";

/**
 * The unified theme, and the one-time adoption of whatever the four legacy apps
 * had.
 *
 * Somebody who has been using RECALL in dark mode for a year should not open
 * the unified app into a white screen. Equally, the legacy keys must be read
 * and never written — those apps are still deployed and keep their own
 * preference, and stamping ours into them would change what they show.
 */
describe("seeding the theme from a legacy app", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("adopts a legacy dark preference", () => {
    localStorage.setItem(KEYS.hooklabTheme, "dark");
    expect(seedThemeFromLegacy()).toBe("dark");
  });

  it("adopts a legacy light preference", () => {
    localStorage.setItem(KEYS.blastTheme, "light");
    expect(seedThemeFromLegacy()).toBe("light");
  });

  it("reads BLAST's hyphenated key, which breaks the _v1 convention", () => {
    // `blast-theme`, not `blast_theme_v1` — a real inconsistency in the legacy
    // apps that the key registry pins deliberately.
    expect(KEYS.blastTheme).toBe("blast-theme");
    localStorage.setItem("blast-theme", "dark");
    expect(seedThemeFromLegacy()).toBe("dark");
  });

  it("tolerates a value written as a JSON string", () => {
    // Some of the legacy apps wrote the bare word, others JSON.stringify'd it.
    localStorage.setItem(KEYS.pulseTheme, '"dark"');
    expect(seedThemeFromLegacy()).toBe("dark");
  });

  it("prefers HOOKLAB, then BLAST, then PULSE", () => {
    // A fixed order beats "whichever localStorage happens to enumerate first",
    // which is why the loop is explicit.
    localStorage.setItem(KEYS.hooklabTheme, "light");
    localStorage.setItem(KEYS.blastTheme, "dark");
    localStorage.setItem(KEYS.pulseTheme, "dark");
    expect(seedThemeFromLegacy()).toBe("light");

    localStorage.removeItem(KEYS.hooklabTheme);
    expect(seedThemeFromLegacy()).toBe("dark");
  });

  it("returns null when no legacy app had a preference", () => {
    // null means "leave it on system" rather than picking one for them.
    expect(seedThemeFromLegacy()).toBeNull();
  });

  it("ignores a junk value rather than applying it", () => {
    localStorage.setItem(KEYS.hooklabTheme, "chartreuse");
    expect(seedThemeFromLegacy()).toBeNull();
  });

  it("never writes to a legacy key", () => {
    // Those apps are still deployed and still read these.
    localStorage.setItem(KEYS.hooklabTheme, "dark");
    seedThemeFromLegacy();
    expect(localStorage.getItem(KEYS.hooklabTheme)).toBe("dark");
    expect(localStorage.getItem(KEYS.blastTheme)).toBeNull();
    expect(localStorage.getItem(KEYS.pulseTheme)).toBeNull();
  });
});

describe("applying a theme to the document", () => {
  beforeEach(() => document.documentElement.removeAttribute("data-theme"));

  it("stamps an explicit choice onto the root", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("REMOVES the attribute for system rather than writing a value", () => {
    // The CSS falls back to prefers-color-scheme only when the attribute is
    // absent — writing data-theme="system" would match no rule and leave the
    // page on whatever the light defaults are.
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

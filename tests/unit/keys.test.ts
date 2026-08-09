import { describe, it, expect } from "vitest";
import {
  KEYS,
  SESSION_KEYS,
  ALL_KEYS,
  ALL_SESSION_KEYS,
  isStackKey,
} from "../../src/data/keys";
import {
  SYNC_EXCLUDE,
  ALWAYS_EXCLUDE,
  DEVICE_PRESERVE,
} from "../../src/data/stackdata/constants";

/**
 * These names are a contract with four still-deployed apps sharing this origin.
 * A rename does not migrate data — it orphans it, and can silently drop it from
 * every backup. Each test below pins a specific way that has already gone wrong.
 */
describe("key registry", () => {
  it("keeps every key inside the stack prefix the backup engine filters on", () => {
    // A key failing this is invisible to backup, restore and sync.
    for (const key of [...ALL_KEYS, ...ALL_SESSION_KEYS]) {
      expect(isStackKey(key), `${key} is not a stack-prefixed key`).toBe(true);
    }
  });

  it("has no duplicate key names", () => {
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
  });

  it("pins the legacy names exactly, quirks and all", () => {
    // blast-theme is the one BLAST key using a hyphen. Normalizing it to
    // blast_theme would orphan every existing user's theme.
    expect(KEYS.blastTheme).toBe("blast-theme");
    expect(KEYS.hooklabTheme).toBe("hooklab_theme");
    expect(KEYS.pulseTheme).toBe("pulse-theme");
    // Source-of-truth keys the other apps read.
    expect(KEYS.blastQueue).toBe("blast_queue_v1");
    expect(KEYS.blastSession).toBe("blast_session_v1");
    expect(KEYS.hooklabState).toBe("hooklab_state_v1");
    expect(KEYS.pulsePosts).toBe("pulse_posts_v1");
    expect(KEYS.recallStateLegacy).toBe("recall_state_v2");
  });

  it("keeps per-tab view state in sessionStorage, not localStorage", () => {
    expect(SESSION_KEYS.pulseExpanded).toBe("pulse_expanded_v1");
    expect(SESSION_KEYS.pulsePlatform).toBe("pulse_platform_v1");
    for (const k of ALL_SESSION_KEYS) expect(ALL_KEYS).not.toContain(k);
  });
});

describe("sync exclusion lists", () => {
  it("never lets an API-key store reach a sync payload", () => {
    // The whole privacy guarantee of Drive sync rests on this list.
    for (const k of [
      KEYS.stackSettings,
      KEYS.recallSettings,
      KEYS.hooklabSettings,
      KEYS.blastSettings,
      KEYS.pulseSettings,
    ]) {
      expect(SYNC_EXCLUDE, `${k} must never sync`).toContain(k);
    }
  });

  it("excludes the BLAST session projection but not the queue", () => {
    // The projection is re-stamped on every keystroke; syncing it let a stale
    // device win newest-wins and clobber real work. The queue is the truth.
    expect(SYNC_EXCLUDE).toContain(KEYS.blastSession);
    expect(SYNC_EXCLUDE).not.toContain(KEYS.blastQueue);
  });

  it("keeps device Drive bookkeeping out of every export", () => {
    expect(ALWAYS_EXCLUDE).toContain(KEYS.stackSyncMeta);
  });

  it("preserves device-scoped keys across a REPLACE restore", () => {
    // A backup that simply lacks keys or themes must not blank them here.
    for (const k of [KEYS.stackSettings, KEYS.blastTheme, KEYS.stackTheme]) {
      expect(DEVICE_PRESERVE).toContain(k);
    }
  });

  it("treats the new unified theme as device-scoped, like the three it replaces", () => {
    expect(SYNC_EXCLUDE).toContain(KEYS.stackTheme);
    expect(DEVICE_PRESERVE).toContain(KEYS.stackTheme);
  });

  it("does not sync data-bearing keys by accident", () => {
    // Guards a plausible mistake: adding a key to SYNC_EXCLUDE that actually
    // needs to travel between devices.
    for (const k of [KEYS.pulsePosts, KEYS.hooklabState, KEYS.blastPresets]) {
      expect(SYNC_EXCLUDE, `${k} must sync`).not.toContain(k);
    }
  });
});

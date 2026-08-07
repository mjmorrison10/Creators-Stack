import { describe, it, expect, beforeEach } from "vitest";
import {
  addEntry,
  applyImport,
  buildExport,
  createEntry,
  deleteComp,
  deleteEntry,
  isAutoPromoted,
  isPulseEntry,
  normalizeLedgerImport,
  readState,
  uid,
  updateEntry,
  writeState,
  EXPORT_FILENAME,
} from "../../src/domain/hooklab/ledger";
import { readTombstones } from "../../src/data/stackdata/tombstones";
import { KEYS } from "../../src/data/keys";
import { PATTERNS } from "../../src/domain/hooklab/patterns";
import type { HooklabState, LedgerEntry } from "../../src/data/schemas/hooklab";

beforeEach(() => localStorage.clear());

const empty: HooklabState = { ledger: [], comps: [] };

describe("id conventions", () => {
  it("mints ids in the legacy shape", () => {
    // Other apps recognize entries by this prefix; PULSE reserves its own.
    expect(uid()).toMatch(/^id_[a-z0-9]+$/);
    expect(uid()).not.toBe(uid());
  });

  it("recognizes the ids PULSE owns", () => {
    const mk = (id: string): LedgerEntry => ({ id, hook: "h", outcome: "winner" });
    expect(isPulseEntry(mk("pulse_p_abc"))).toBe(true);
    expect(isPulseEntry(mk("pulseauto_p_abc"))).toBe(true);
    expect(isPulseEntry(mk("id_native"))).toBe(false);

    expect(isAutoPromoted(mk("pulseauto_p_abc"))).toBe(true);
    expect(isAutoPromoted(mk("pulse_p_abc"))).toBe(false);
    // source is the fallback signal when the id was minted elsewhere.
    expect(isAutoPromoted({ ...mk("id_x"), source: "pulse-auto" })).toBe(true);
  });
});

describe("entry construction", () => {
  it("derives family from the chosen pattern", () => {
    const p = PATTERNS[0]!;
    const e = createEntry({ hook: "a hook", patternId: p.id });
    expect(e.family).toBe(p.family);
    expect(e.createdAt).toBeTruthy();
    expect(e.editedAt).toBeUndefined();
  });

  it("falls back to 'unknown' family rather than an empty key", () => {
    // Scoring groups on family; a blank key would merge unrelated entries.
    expect(createEntry({ hook: "h", patternId: "nonexistent" }).family).toBe("unknown");
    expect(createEntry({ hook: "h" }).family).toBe("unknown");
  });

  it("derives medium from the platform", () => {
    expect(createEntry({ hook: "h", platform: "tiktok" }).medium).toBe("video");
    expect(createEntry({ hook: "h", platform: "x" }).medium).toBe("text");
  });

  it("uses ISO timestamps, not epoch numbers", () => {
    // HOOKLAB is ISO; BLAST is ms-epoch. The merge engine has separate
    // comparators, so conflating them corrupts conflict resolution.
    expect(typeof createEntry({ hook: "h" }).createdAt).toBe("string");
    expect(createEntry({ hook: "h" }).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("editing", () => {
  const orig: LedgerEntry = {
    id: "pulse_p_abc",
    hook: "original",
    outcome: "meh",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "pulse",
  };

  it("preserves id, createdAt and source through an edit", () => {
    // Losing `source` would make a later PULSE re-log create a twin instead of
    // matching the entry that already exists.
    const updated = updateEntry(orig, { hook: "edited", outcome: "winner" });
    expect(updated.id).toBe("pulse_p_abc");
    expect(updated.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(updated.source).toBe("pulse");
    expect(updated.hook).toBe("edited");
  });

  it("stamps editedAt only on edit", () => {
    expect(updateEntry(orig, { hook: "x" }).editedAt).toBeTruthy();
    // editedAt is what the merge engine prefers for conflict resolution.
    expect(createEntry({ hook: "x" }).editedAt).toBeUndefined();
  });

  it("does not invent a source for a natively-created entry", () => {
    const native: LedgerEntry = { id: "id_1", hook: "h", outcome: "meh" };
    expect(updateEntry(native, { hook: "h2" }).source).toBeUndefined();
  });
});

describe("ordering", () => {
  it("prepends new entries, newest first", () => {
    // fatigueScore reads the first 10; append order would make it read the
    // oldest entries and never register fatigue.
    const s1 = addEntry(empty, createEntry({ hook: "first" }));
    const s2 = addEntry(s1, createEntry({ hook: "second" }));
    expect(s2.ledger.map((e) => e.hook)).toEqual(["second", "first"]);
  });
});

describe("deletion", () => {
  it("writes a tombstone so sync cannot resurrect the entry", () => {
    const state = addEntry(empty, { id: "id_del", hook: "h", outcome: "meh" });
    const after = deleteEntry(state, "id_del");
    expect(after.ledger).toHaveLength(0);
    expect(readTombstones()).toHaveProperty("hooklabLedger:id_del");
  });

  it("tombstones comps under their own kind", () => {
    const state: HooklabState = { ledger: [], comps: [{ id: "c1", hook: "comp" }] };
    deleteComp(state, "c1");
    expect(readTombstones()).toHaveProperty("hooklabComp:c1");
  });
});

describe("export", () => {
  it("matches the legacy envelope and filename exactly", () => {
    // No format or version marker — that is the legacy shape, and changing it
    // would break importing into the still-deployed app.
    const env = buildExport({ ledger: [{ id: "id_1", hook: "h", outcome: "winner" }], comps: [] });
    expect(Object.keys(env).sort()).toEqual(["comps", "exportedAt", "ledger"]);
    expect(EXPORT_FILENAME).toBe("hooklab-ledger.json");
  });
});

describe("import", () => {
  it("drops entries with no hook text", () => {
    const rows = normalizeLedgerImport([
      { id: "a", hook: "real" },
      { id: "b", hook: "   " },
      { id: "c" },
      null,
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("mints an id where one is missing", () => {
    // An entry with an empty id once made Delete match every other id-less
    // entry and wipe the ledger.
    const rows = normalizeLedgerImport([{ hook: "no id here" }]);
    expect(rows[0]?.id).toMatch(/^id_/);
  });

  it("accepts a bare array as well as a {ledger, comps} object", () => {
    const fromArray = applyImport(empty, [{ id: "a", hook: "h" }]);
    expect(fromArray.ledger).toHaveLength(1);

    const fromObject = applyImport(empty, {
      ledger: [{ id: "a", hook: "h" }],
      comps: [{ id: "c", hook: "comp" }],
    });
    expect(fromObject.ledger).toHaveLength(1);
    expect(fromObject.comps).toHaveLength(1);
  });

  it("prepends imported entries ahead of existing ones", () => {
    const existing = addEntry(empty, { id: "old", hook: "existing", outcome: "meh" });
    const after = applyImport(existing, [{ id: "new", hook: "imported" }]);
    expect(after.ledger.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("survives junk input rather than throwing", () => {
    expect(applyImport(empty, null).ledger).toEqual([]);
    expect(applyImport(empty, { ledger: "not an array" }).ledger).toEqual([]);
  });
});

describe("persistence", () => {
  it("round-trips through the legacy key, in the shape other apps read", () => {
    writeState({ ledger: [{ id: "id_1", hook: "h", outcome: "winner" }], comps: [] });

    // BLAST reads this exact key and expects {ledger, comps} at the top level.
    const raw = localStorage.getItem(KEYS.hooklabState);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { ledger: unknown[]; comps: unknown[] };
    expect(Array.isArray(parsed.ledger)).toBe(true);
    expect(Array.isArray(parsed.comps)).toBe(true);
    expect(parsed.ledger[0]).toMatchObject({ id: "id_1", hook: "h", outcome: "winner" });

    expect(readState().ledger).toHaveLength(1);
  });

  it("tolerates a corrupt or partial blob", () => {
    // This key is shared with three other apps; a half-written value must not
    // brick the section.
    localStorage.setItem(KEYS.hooklabState, "{not json");
    expect(readState()).toEqual({ ledger: [], comps: [] });

    localStorage.setItem(KEYS.hooklabState, JSON.stringify({ ledger: "bad" }));
    expect(readState()).toEqual({ ledger: [], comps: [] });
  });
});

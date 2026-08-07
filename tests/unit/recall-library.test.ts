import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addSource,
  applyLibraryImport,
  binHas,
  binItemRange,
  binKey,
  buildBinSRT,
  buildLibraryExport,
  buildShotList,
  clearBin,
  highlightRanges,
  libraryFilename,
  LibraryImportError,
  parseLibraryFile,
  removeSource,
  renameSource,
  search,
  srtFilename,
  srtTime,
  summarizeImport,
  terms,
  toggleBin,
  toggleSource,
} from "../../src/domain/recall/library";
import type {
  RecallLibrary,
  RecallLibraryExport,
  RecallSource,
} from "../../src/data/schemas/recall";

const APP_JS = resolve(import.meta.dirname, "../../../recall/app.js");

/**
 * `srtTime`, `binItemRange` and `applyLibraryImport` decide what an exported
 * clip range is and what an import does to an existing library — both things a
 * user notices only after the damage. They close over `state` rather than
 * taking it, so the legacy source is sliced out and given a state to close
 * over, then diffed against the port.
 */
function loadLegacy(state: RecallLibrary): {
  srtTime: (sec: number) => string;
  binItemRange: (b: unknown) => { start: number; end: number };
  applyLibraryImport: (
    data: unknown,
    mode: string,
  ) => { added: number; skipped: number; mode: string };
  state: RecallLibrary;
} {
  const src = readFileSync(APP_JS, "utf8");
  const slice = (from: string, to: string): string => {
    const a = src.indexOf(from);
    const b = src.indexOf(to);
    if (a === -1 || b === -1 || b <= a) throw new Error(`could not slice ${from}`);
    return src.slice(a, b);
  };
  const block =
    slice("function srtTime(sec)", "function exportBinSRT()") +
    slice("function applyLibraryImport(data, mode)", "function refreshAfterImport()");

  return new Function(
    "state",
    `${block}
     return {srtTime, binItemRange, applyLibraryImport, state};`,
  )(state) as ReturnType<typeof loadLegacy>;
}

function source(over: Partial<RecallSource> = {}): RecallSource {
  return {
    id: "s1",
    title: "A source",
    segments: [
      { t: "0:00:05", sec: 5, text: "Discipline is just remembering what you want." },
      { t: "0:00:22", sec: 22, text: "Confidence comes after the work, never before it." },
      { t: "0:00:41", sec: 41, text: "The hardest rep is the one nobody sees." },
    ],
    ...over,
  };
}

function library(over: Partial<RecallLibrary> = {}): RecallLibrary {
  return { sources: [source()], enabled: ["s1"], bin: [], ...over };
}

describe("search", () => {
  it("requires every term to appear, in any order", () => {
    const lib = library();
    expect(search(lib, "confidence work").hits).toHaveLength(1);
    expect(search(lib, "work confidence").hits).toHaveLength(1);
    // "confidence" and "rep" never share a moment.
    expect(search(lib, "confidence rep").hits).toHaveLength(0);
  });

  it("matches inside words and ignores case", () => {
    expect(search(library(), "DISCIPL").hits).toHaveLength(1);
  });

  it("only scans sources that are switched on", () => {
    const lib = library({ enabled: [] });
    expect(search(lib, "confidence").hits).toHaveLength(0);
    expect(search(lib, "confidence").enabledSources).toBe(0);
  });

  it("reports the idle totals when there is no query", () => {
    const r = search(library(), "   ");
    expect(r.hits).toEqual([]);
    expect(r.totalMoments).toBe(3);
    expect(r.enabledSources).toBe(1);
  });

  it("counts distinct sources, not hits", () => {
    const lib = library({
      sources: [source(), source({ id: "s2", title: "Another" })],
      enabled: ["s1", "s2"],
    });
    const r = search(lib, "the");
    expect(r.matchedSources).toBe(2);
    expect(r.hits.length).toBeGreaterThan(2);
  });

  it("carries the previous moment as context, and none for the first", () => {
    const hits = search(library(), "confidence").hits;
    expect(hits[0]?.prev?.sec).toBe(5);
    expect(search(library(), "discipline").hits[0]?.prev).toBeUndefined();
  });

  it("keys every hit the way the bin does", () => {
    const h = search(library(), "confidence").hits[0]!;
    expect(h.key).toBe("s1@22@1");
    expect(h.key).toBe(binKey("s1", 22, 1));
  });

  it("drops empty terms rather than matching everything", () => {
    expect(terms("  a   b  ")).toEqual(["a", "b"]);
  });
});

describe("highlighting", () => {
  it("finds every occurrence of every term", () => {
    expect(highlightRanges("work the work", ["work"])).toEqual([
      [0, 4],
      [9, 13],
    ]);
  });

  it("treats regex metacharacters in the query literally", () => {
    // Otherwise a stray "(" from a user's search throws and blanks the results.
    expect(() => highlightRanges("a (b) c", ["(b)"])).not.toThrow();
    expect(highlightRanges("a (b) c", ["(b)"])).toEqual([[2, 5]]);
    expect(highlightRanges("a.b", ["."])).toEqual([[1, 2]]);
  });

  it("returns nothing when there are no terms", () => {
    expect(highlightRanges("anything", [])).toEqual([]);
  });
});

describe("the clip bin", () => {
  it("adds and then removes the same moment", () => {
    const added = toggleBin(library(), "s1", 1);
    expect(added.bin).toHaveLength(1);
    expect(added.bin[0]).toMatchObject({
      key: "s1@22@1",
      srcId: "s1",
      srcTitle: "A source",
      sec: 22,
    });
    expect(toggleBin(added, "s1", 1).bin).toHaveLength(0);
  });

  it("carries pattern provenance when it is supplied", () => {
    const lib = toggleBin(library(), "s1", 0, {
      patternId: "p1",
      patternName: "Curiosity gap",
      patternFamily: "curiosity",
    });
    expect(lib.bin[0]).toMatchObject({ patternId: "p1", patternFamily: "curiosity" });
  });

  it("omits blank provenance instead of storing an empty field", () => {
    // A present-but-empty patternId reads downstream as "this clip has a
    // pattern", which is how PULSE ends up promoting an entry it can't name.
    const lib = toggleBin(library(), "s1", 0, { patternId: "", label: undefined });
    expect(lib.bin[0]).not.toHaveProperty("patternId");
    expect(lib.bin[0]).not.toHaveProperty("label");
  });

  it("is a no-op for an unknown source or index", () => {
    const lib = library();
    expect(toggleBin(lib, "nope", 0)).toBe(lib);
    expect(toggleBin(lib, "s1", 99)).toBe(lib);
  });

  it("reports membership by key", () => {
    const lib = toggleBin(library(), "s1", 1);
    expect(binHas(lib, "s1@22@1")).toBe(true);
    expect(binHas(lib, "s1@5@0")).toBe(false);
  });

  it("empties on clear", () => {
    expect(clearBin(toggleBin(library(), "s1", 0)).bin).toEqual([]);
  });
});

describe("source management", () => {
  it("toggles a source on and off", () => {
    expect(toggleSource(library(), "s1").enabled).toEqual([]);
    expect(toggleSource(library({ enabled: [] }), "s1").enabled).toEqual(["s1"]);
  });

  it("enables a newly added source", () => {
    const lib = addSource(library(), source({ id: "s2" }));
    expect(lib.sources).toHaveLength(2);
    expect(lib.enabled).toContain("s2");
  });

  it("takes the source's bin items with it on delete", () => {
    // A bin entry pointing at a deleted source exports a clip nobody can find.
    let lib = library({ sources: [source(), source({ id: "s2" })], enabled: ["s1", "s2"] });
    lib = toggleBin(toggleBin(lib, "s1", 0), "s2", 0);
    expect(lib.bin).toHaveLength(2);

    const after = removeSource(lib, "s1");
    expect(after.sources.map((s) => s.id)).toEqual(["s2"]);
    expect(after.enabled).toEqual(["s2"]);
    expect(after.bin.map((b) => b.srcId)).toEqual(["s2"]);
  });

  it("renames the source and every bin item that denormalized its title", () => {
    const lib = renameSource(toggleBin(library(), "s1", 0), "s1", "  Renamed  ");
    expect(lib.sources[0]!.title).toBe("Renamed");
    expect(lib.bin[0]!.srcTitle).toBe("Renamed");
  });

  it("refuses a blank rename rather than clearing the title", () => {
    const lib = library();
    expect(renameSource(lib, "s1", "   ")).toBe(lib);
  });
});

describe("SRT export", () => {
  it("formats times as SubRip expects", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(3661.5)).toBe("01:01:01,500");
  });

  it("runs each clip until the next moment starts", () => {
    const lib = toggleBin(toggleBin(library(), "s1", 0), "s1", 1);
    expect(buildBinSRT(lib)).toBe(
      [
        "1",
        "00:00:05,000 --> 00:00:22,000",
        "Discipline is just remembering what you want.",
        "",
        "2",
        "00:00:22,000 --> 00:00:41,000",
        "Confidence comes after the work, never before it.",
        "",
        "",
      ].join("\n"),
    );
  });

  it("gives the last moment in a source a fixed tail", () => {
    const lib = toggleBin(library(), "s1", 2);
    expect(binItemRange(lib, lib.bin[0]!)).toEqual({ start: 41, end: 71 });
  });

  it("falls back to the fixed tail when the source is gone", () => {
    const lib = toggleBin(library(), "s1", 0);
    const orphaned = { ...lib, sources: [] };
    expect(binItemRange(orphaned, lib.bin[0]!)).toEqual({ start: 5, end: 35 });
  });

  it("writes a shot list an editor can read", () => {
    const lib = toggleBin(library(), "s1", 0);
    expect(buildShotList(lib)).toBe(
      "1. [0:00:05] A source\n   Discipline is just remembering what you want.\n",
    );
  });

  it("stamps the filenames with the date", () => {
    const d = new Date("2026-08-07T12:00:00Z");
    expect(srtFilename(d)).toBe("recall-clips-2026-08-07.srt");
    expect(libraryFilename(d)).toBe("recall-library-2026-08-07.json");
  });
});

describe("library export envelope", () => {
  it("matches the legacy shape exactly", () => {
    // The still-deployed RECALL reads these files.
    const env = buildLibraryExport(library(), new Date("2026-08-07T12:00:00Z"));
    expect(Object.keys(env).sort()).toEqual([
      "app",
      "exportedAt",
      "library",
      "schema",
      "version",
    ]);
    expect(env.schema).toBe("recall.library.v1");
    expect(env.version).toBe(1);
    expect(env.app).toBe("RECALL");
    expect(Object.keys(env.library).sort()).toEqual(["bin", "enabled", "sources"]);
  });

  it("round-trips through the parser", () => {
    const env = buildLibraryExport(library());
    expect(parseLibraryFile(JSON.parse(JSON.stringify(env)))).toEqual(env);
  });

  it("rejects a file that is not a RECALL library", () => {
    expect(() => parseLibraryFile({ schema: "mjm-stack-backup" })).toThrow(LibraryImportError);
    expect(() => parseLibraryFile(null)).toThrow(/schema mismatch/);
    expect(() => parseLibraryFile({ schema: "recall.library.v1" })).toThrow(/missing or malformed/);
  });

  it("summarizes what a file will bring in", () => {
    const env = buildLibraryExport(
      toggleBin(library(), "s1", 0),
      new Date("2026-08-07T12:00:00Z"),
    );
    expect(summarizeImport(env)).toEqual({
      sources: 1,
      moments: 3,
      bin: 1,
      exportedAt: "2026-08-07",
    });
  });
});

describe("library import", () => {
  const incoming: RecallLibraryExport = buildLibraryExport({
    sources: [source({ id: "s1", title: "Incoming version of s1" }), source({ id: "s9" })],
    enabled: ["s1", "s9"],
    bin: [{ key: "s9@5@0", srcId: "s9", srcTitle: "x", t: "0:00:05", sec: 5, text: "hi" }],
  });

  it("replace swaps the whole library, bin included", () => {
    const r = applyLibraryImport(library(), incoming, "replace");
    expect(r.added).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.library.sources.map((s) => s.id)).toEqual(["s1", "s9"]);
    expect(r.library.sources[0]!.title).toBe("Incoming version of s1");
    expect(r.library.bin).toHaveLength(1);
  });

  it("merge adds only new sources and never overwrites an existing one", () => {
    const r = applyLibraryImport(library(), incoming, "merge");
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.library.sources.map((s) => s.id)).toEqual(["s1", "s9"]);
    // The local s1 survives untouched — that is the whole point of merge.
    expect(r.library.sources[0]!.title).toBe("A source");
  });

  it("merge never imports bin items", () => {
    // The bin is a working set; a merge resurrecting cleared clips would be
    // indistinguishable from a sync bug.
    expect(applyLibraryImport(library(), incoming, "merge").library.bin).toEqual([]);
  });

  it("merge carries the enabled flag for sources it adds", () => {
    expect(applyLibraryImport(library(), incoming, "merge").library.enabled).toEqual(["s1", "s9"]);
  });

  it("tolerates a file with no enabled or bin arrays", () => {
    const bare = {
      ...incoming,
      library: { sources: incoming.library.sources },
    } as unknown as RecallLibraryExport;
    expect(applyLibraryImport(library(), bare, "replace").library.enabled).toEqual([]);
    expect(applyLibraryImport(library(), bare, "replace").library.bin).toEqual([]);
  });
});

describe("parity with the original app.js", () => {
  const incomingRaw: RecallLibraryExport = buildLibraryExport({
    sources: [source({ id: "s1", title: "Incoming version of s1" }), source({ id: "s9" })],
    enabled: ["s1", "s9"],
    bin: [{ key: "s9@5@0", srcId: "s9", srcTitle: "x", t: "0:00:05", sec: 5, text: "hi" }],
  });

  it("formats SRT timestamps identically", () => {
    const legacy = loadLegacy(library());
    for (const sec of [0, 1, 59.999, 60, 3599, 3600, 3661.5, 86399, 0.4995]) {
      expect(srtTime(sec), String(sec)).toBe(legacy.srtTime(sec));
    }
  });

  it("computes clip ranges identically, including the duplicate-second case", () => {
    // Segments sharing a start time are normal — every long-paragraph split
    // produces a run of them — and the legacy lookup matches on `sec`, so it
    // resolves to the first. Preserved deliberately; users have cut against it.
    const dup = source({
      segments: [
        { t: "0:00:05", sec: 5, text: "first half of a long block" },
        { t: "0:00:05", sec: 5, text: "second half of the same block" },
        { t: "0:00:41", sec: 41, text: "a later moment" },
      ],
    });
    const lib = library({ sources: [dup] });
    const legacy = loadLegacy(lib);

    for (const idx of [0, 1, 2]) {
      const withItem = toggleBin(lib, "s1", idx);
      const item = withItem.bin[0]!;
      expect(binItemRange(withItem, item), `idx ${idx}`).toEqual(legacy.binItemRange(item));
    }

    const missing = { key: "gone@9@0", srcId: "gone", srcTitle: "x", t: "0:00:09", sec: 9, text: "" };
    expect(binItemRange(lib, missing)).toEqual(legacy.binItemRange(missing));
  });

  it("applies both import modes identically", () => {
    for (const mode of ["replace", "merge"] as const) {
      const start = library();
      const legacy = loadLegacy(structuredClone(start));
      const legacyCounts = legacy.applyLibraryImport(structuredClone(incomingRaw), mode);
      const ported = applyLibraryImport(start, incomingRaw, mode);

      expect({ added: ported.added, skipped: ported.skipped, mode: ported.mode }, mode).toEqual(
        legacyCounts,
      );
      expect(ported.library, mode).toEqual(legacy.state);
    }
  });
});

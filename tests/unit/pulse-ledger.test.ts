import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as port from "../../src/domain/pulse/ledger";
import { KEYS } from "../../src/data/keys";
import type { PulsePost, Snapshot } from "../../src/data/schemas/pulse";

/**
 * PULSE writing into HOOKLAB's ledger.
 *
 * This is the one cross-app write in the stack, and TOP CLIPS reads these rows
 * back as the creator's own proof. Two id namespaces share one array —
 * `pulse_*` for a human verdict, `pulseauto_*` for the engine — and the tests
 * that matter most are the ones proving neither can reach the other's rows, or
 * a HOOKLAB-native entry.
 */

let seq = 0;
function snap(views: number): Snapshot {
  return { at: 1000, elapsedMin: 60, views, likes: null, comments: null, source: "manual" };
}

function post(over: Partial<PulsePost> = {}): PulsePost {
  return {
    id: `p_${++seq}`,
    platform: "TikTok",
    url: "https://tiktok.com/1",
    caption: "",
    hook: "the hardest rep is the one nobody sees",
    postedAt: 1000,
    snapshots: [snap(5000)],
    outcome: null,
    ledgerLoggedAt: null,
    ...over,
  };
}

function ledger(): Record<string, unknown>[] {
  const raw = localStorage.getItem(KEYS.hooklabState);
  return raw ? ((JSON.parse(raw) as { ledger?: Record<string, unknown>[] }).ledger ?? []) : [];
}

function seedHooklab(entries: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    KEYS.hooklabState,
    JSON.stringify({ ledger: entries, comps: [], ...extra }),
  );
}

describe("logging a verdict", () => {
  beforeEach(() => localStorage.clear());

  it("writes an entry under the deterministic pulse_ id", () => {
    const p = post({ id: "p_abc" });
    const r = port.logToLedger(p, "winner", 5000);
    expect(r.ok).toBe(true);
    expect(ledger()[0]!.id).toBe("pulse_p_abc");
  });

  it("records the hook, pattern, platform, medium and views", () => {
    const p = post({
      id: "p_1",
      patternId: "p_identity",
      patternFamily: "identity",
      platform: "X",
    });
    port.logToLedger(p, "winner", 5000);
    expect(ledger()[0]).toMatchObject({
      hook: "the hardest rep is the one nobody sees",
      patternId: "p_identity",
      family: "identity",
      platform: "X",
      medium: "text",
      views: "5000",
      outcome: "winner",
      source: "pulse",
      niche: "general",
      retention: "",
    });
  });

  it("does NOT carry patternName — HOOKLAB resolves the name from its bank", () => {
    port.logToLedger(post({ patternName: "Identity claim" }), "winner", 5000);
    expect(ledger()[0]!.patternName).toBeUndefined();
  });

  it("says unknown rather than guessing a family it was never told", () => {
    // The honesty rule: a hand-added post has no pattern, and inventing one
    // would put a fabricated family into the creator's evidence.
    port.logToLedger(post({ patternFamily: "" }), "meh", 5000);
    expect(ledger()[0]!.family).toBe("unknown");
    expect(ledger()[0]!.patternId).toBe("");
  });

  it("falls back to the caption's first line when there is no hook", () => {
    port.logToLedger(post({ hook: "", caption: "first line\nsecond line" }), "winner", 5000);
    expect(ledger()[0]!.hook).toBe("first line");
  });

  it("says (clip) rather than writing an empty hook", () => {
    port.logToLedger(post({ hook: "", caption: "" }), "winner", 5000);
    expect(ledger()[0]!.hook).toBe("(clip)");
  });

  it("caps the hook at 300 characters", () => {
    port.logToLedger(post({ hook: "h".repeat(400) }), "winner", 5000);
    expect(String(ledger()[0]!.hook)).toHaveLength(300);
  });

  it("leaves views empty when nothing has been read yet", () => {
    // "0" would claim a measurement; empty says there isn't one.
    port.logToLedger(post({ snapshots: [] }), "winner", 5000);
    expect(ledger()[0]!.views).toBe("");
  });

  it("keeps the legacy notes string exactly, trailing space and all", () => {
    // The string is already in people's ledgers; changing it would make a
    // re-log look like a different entry.
    port.logToLedger(post({ url: "" }), "winner", 5000);
    expect(ledger()[0]!.notes).toBe("via PULSE: ");
  });

  it("stamps an ISO createdAt", () => {
    port.logToLedger(post(), "winner", Date.parse("2026-08-08T12:00:00Z"));
    expect(ledger()[0]!.createdAt).toBe("2026-08-08T12:00:00.000Z");
  });

  it("stamps the post with its verdict and the time", () => {
    const r = port.logToLedger(post(), "dead", 5000);
    expect(r.post.outcome).toBe("dead");
    expect(r.post.ledgerLoggedAt).toBe(5000);
  });

  it("does not mutate the post it was handed", () => {
    const p = post();
    port.logToLedger(p, "winner", 5000);
    expect(p.outcome).toBeNull();
    expect(p.ledgerLoggedAt).toBeNull();
  });

  it("replaces rather than duplicating when the verdict changes", () => {
    const p = post({ id: "p_1" });
    port.logToLedger(p, "winner", 5000);
    port.logToLedger(p, "dead", 6000);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]!.outcome).toBe("dead");
  });

  it("moves a re-logged entry back to the front", () => {
    seedHooklab([{ id: "pulse_p_1", outcome: "winner" }, { id: "id_native", hook: "theirs" }]);
    port.logToLedger(post({ id: "p_1" }), "meh", 6000);
    expect(ledger()[0]!.id).toBe("pulse_p_1");
    expect(ledger()).toHaveLength(2);
  });

  it("never disturbs a HOOKLAB-native entry", () => {
    seedHooklab([{ id: "id_native", hook: "written in HOOKLAB" }]);
    port.logToLedger(post(), "winner", 5000);
    expect(ledger().find((e) => e.id === "id_native")).toEqual({
      id: "id_native",
      hook: "written in HOOKLAB",
    });
  });

  it("never disturbs an auto-promoted entry", () => {
    seedHooklab([{ id: "pulseauto_p_9", hook: "auto" }]);
    port.logToLedger(post(), "winner", 5000);
    expect(ledger().find((e) => e.id === "pulseauto_p_9")).toBeTruthy();
  });

  it("preserves the rest of the HOOKLAB blob", () => {
    // comps and any other keys belong to HOOKLAB; PULSE must hand them back.
    seedHooklab([], { comps: [{ id: "c1" }], brandVoice: "plain" });
    port.logToLedger(post(), "winner", 5000);
    const st = JSON.parse(localStorage.getItem(KEYS.hooklabState)!) as Record<string, unknown>;
    expect(st.comps).toEqual([{ id: "c1" }]);
    expect(st.brandVoice).toBe("plain");
  });

  it("survives a corrupt HOOKLAB blob rather than throwing", () => {
    localStorage.setItem(KEYS.hooklabState, "{not json");
    expect(port.logToLedger(post(), "winner", 5000).ok).toBe(true);
  });

  it("survives a ledger that is not an array", () => {
    localStorage.setItem(KEYS.hooklabState, JSON.stringify({ ledger: "corrupt" }));
    expect(port.logToLedger(post(), "winner", 5000).ok).toBe(true);
    expect(ledger()).toHaveLength(1);
  });
});

describe("when the ledger write fails", () => {
  const realSetItem = Storage.prototype.setItem;
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    Storage.prototype.setItem = realSetItem;
  });

  it("does NOT stamp the post", () => {
    // A stamp with no ledger row behind it tells the creator their verdict was
    // recorded when it wasn't.
    Storage.prototype.setItem = function () {
      throw new DOMException("full", "QuotaExceededError");
    };
    const r = port.logToLedger(post(), "winner", 5000);
    expect(r.ok).toBe(false);
    expect(r.post.outcome).toBeNull();
    expect(r.post.ledgerLoggedAt).toBeNull();
  });
});

describe("deleting a verdict", () => {
  beforeEach(() => localStorage.clear());

  it("removes this post's entry", () => {
    seedHooklab([{ id: "pulse_p_1" }]);
    expect(port.deleteLedgerEntry(post({ id: "p_1" }))).toBe(true);
    expect(ledger()).toHaveLength(0);
  });

  it("reports false when there was nothing to remove", () => {
    // False is what tells the caller not to write a tombstone.
    seedHooklab([{ id: "pulse_p_other" }]);
    expect(port.deleteLedgerEntry(post({ id: "p_1" }))).toBe(false);
  });

  it("cannot reach a HOOKLAB-native or auto entry", () => {
    seedHooklab([{ id: "id_native" }, { id: "pulseauto_p_1" }]);
    expect(port.deleteLedgerEntry(post({ id: "p_1" }))).toBe(false);
    expect(ledger()).toHaveLength(2);
  });

  it("reports false on an empty or missing ledger", () => {
    expect(port.deleteLedgerEntry(post())).toBe(false);
    seedHooklab([]);
    expect(port.deleteLedgerEntry(post())).toBe(false);
  });
});

describe("syncing the auto-promoted set", () => {
  beforeEach(() => localStorage.clear());

  /** A platform pool big enough to have a trustworthy median, plus a breakout. */
  function breakout(): PulsePost[] {
    const pool = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700].map((v, i) =>
      post({ id: `p_pool${i}`, platform: "TikTok", snapshots: [snap(v)], hook: `filler ${i}`, clipId: `c${i}` }),
    );
    return [
      ...pool,
      post({ id: "p_win", platform: "TikTok", snapshots: [snap(900000)], hook: "the breakout", clipId: "cw" }),
    ];
  }

  it("writes an auto entry under its own namespace", () => {
    const r = port.syncAutoWinners(breakout(), 5000);
    expect(r.delta).toMatchObject({ added: 1, changed: 0, dropped: 0 });
    expect(ledger()[0]!.id).toBe("pulseauto_p_win");
    expect(ledger()[0]!.source).toBe("pulse-auto");
  });

  it("marks the posts whose hook is currently promoted", () => {
    expect(port.syncAutoWinners(breakout(), 5000).promoted).toEqual({ p_win: true });
  });

  it("reports no change on a second identical pass", () => {
    const posts = breakout();
    port.syncAutoWinners(posts, 5000);
    expect(port.syncAutoWinners(posts, 6000).delta).toBeNull();
  });

  it("RETRACTS an entry whose post no longer qualifies, and says to tombstone it", () => {
    // Without the tombstone the next Drive merge brings back a claim the
    // numbers no longer support.
    const posts = breakout();
    port.syncAutoWinners(posts, 5000);
    const demoted = posts.map((p) => (p.id === "p_win" ? { ...p, snapshots: [snap(1200)] } : p));
    const r = port.syncAutoWinners(demoted, 6000);
    expect(r.delta).toMatchObject({ dropped: 1 });
    expect(r.delta!.tombstone).toEqual(["pulseauto_p_win"]);
    expect(ledger().some((e) => e.id === "pulseauto_p_win")).toBe(false);
  });

  it("updates an entry when a re-import finally supplies the pattern", () => {
    // autoSame includes patternId/family precisely so this is not seen as
    // "no change" and left saying unknown forever.
    const posts = breakout();
    port.syncAutoWinners(posts, 5000);
    expect(ledger()[0]!.family).toBe("unknown");

    const enriched = posts.map((p) =>
      p.id === "p_win" ? { ...p, patternId: "p_identity", patternFamily: "identity" } : p,
    );
    const r = port.syncAutoWinners(enriched, 6000);
    expect(r.delta).toMatchObject({ changed: 1, added: 0 });
    expect(ledger()[0]!.family).toBe("identity");
  });

  it("never touches a manual verdict", () => {
    seedHooklab([{ id: "pulse_p_manual", outcome: "dead" }]);
    port.syncAutoWinners(breakout(), 5000);
    expect(ledger().find((e) => e.id === "pulse_p_manual")).toEqual({
      id: "pulse_p_manual",
      outcome: "dead",
    });
  });

  it("never touches a HOOKLAB-native entry", () => {
    seedHooklab([{ id: "id_native", hook: "theirs" }]);
    port.syncAutoWinners(breakout(), 5000);
    expect(ledger().find((e) => e.id === "id_native")).toEqual({ id: "id_native", hook: "theirs" });
  });

  it("stops promoting a post the moment the creator judges it themselves", () => {
    // The human's call outranks the math, in both directions — and this is the
    // interplay that makes one save both log a verdict AND retract an auto row.
    const posts = breakout();
    port.syncAutoWinners(posts, 5000);
    expect(ledger().some((e) => e.id === "pulseauto_p_win")).toBe(true);

    const judged = posts.map((p) => (p.id === "p_win" ? { ...p, outcome: "dead" as const } : p));
    const r = port.syncAutoWinners(judged, 6000);
    expect(r.delta!.dropped).toBe(1);
    expect(r.promoted).toEqual({});
  });

  it("cleans up a stale auto entry a sync brought in from another device", () => {
    seedHooklab([{ id: "pulseauto_p_ghost", hook: "from another device" }]);
    const r = port.syncAutoWinners([], 5000);
    expect(r.delta!.tombstone).toEqual(["pulseauto_p_ghost"]);
    expect(ledger()).toHaveLength(0);
  });

  it("puts the autos first and leaves everything else in order behind them", () => {
    seedHooklab([{ id: "id_a" }, { id: "id_b" }]);
    port.syncAutoWinners(breakout(), 5000);
    expect(ledger().map((e) => e.id)).toEqual(["pulseauto_p_win", "id_a", "id_b"]);
  });
});

describe("what the creator is told about an auto pass", () => {
  const d = (over: Partial<port.AutoDelta>): port.AutoDelta => ({
    added: 0,
    changed: 0,
    dropped: 0,
    tombstone: [],
    ...over,
  });

  it("announces promotions", () => {
    expect(port.announceAuto(d({ added: 1 }))).toBe("✦ 1 hook auto-promoted to HOOKLAB");
    expect(port.announceAuto(d({ added: 3 }))).toBe("✦ 3 hooks auto-promoted to HOOKLAB");
  });

  it("announces retractions", () => {
    expect(port.announceAuto(d({ dropped: 2 }))).toBe("2 auto hooks dropped (outperformed)");
  });

  it("announces both at once", () => {
    expect(port.announceAuto(d({ added: 1, dropped: 1 }))).toBe(
      "✦ 1 hook auto-promoted to HOOKLAB · 1 auto hook dropped (outperformed)",
    );
  });

  it("says nothing when only the figures were refreshed", () => {
    // A number changing inside an entry the creator already knows about is not
    // news, and a toast for it would be noise on every reading.
    expect(port.announceAuto(d({ changed: 4 }))).toBeNull();
  });
});

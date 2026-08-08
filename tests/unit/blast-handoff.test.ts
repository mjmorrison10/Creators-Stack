import { describe, it, expect } from "vitest";
import { HANDOFF_META, handoffSummary, queueToBlast } from "../../src/domain/blast/handoff";
import { blankPost, QUICK_KEY, type BlastQueue } from "../../src/domain/blast/queue";

function queue(clips = [blankPost(QUICK_KEY, {}, 1000)]): BlastQueue {
  return { v: 1, updatedAt: 1000, defaultPlatforms: null, batchCount: 1, clips };
}

const clip = (over: Record<string, unknown> = {}) => ({
  key: "ep41@41@2",
  srcId: "ep41",
  srcTitle: "Episode 41",
  t: "0:00:41",
  sec: 41,
  text: "The hardest rep is the one nobody sees.",
  ...over,
});

describe("queueing clips from RECALL", () => {
  it("appends a new clip with its provenance intact", () => {
    const r = queueToBlast(
      queue(),
      [clip({ patternId: "p1", patternName: "Identity claim", patternFamily: "identity" })],
      "recall-topclips",
      5000,
    );
    expect(r.added).toBe(1);
    const q = r.queue.clips[1]!;
    expect(q).toMatchObject({
      key: "ep41@41@2",
      srcTitle: "Episode 41",
      patternFamily: "identity",
      source: "recall-topclips",
    });
  });

  it("keeps the Quick post where it is", () => {
    const r = queueToBlast(queue(), [clip()], "recall", 5000);
    expect(r.queue.clips[0]!.key).toBe(QUICK_KEY);
  });

  it("does not duplicate a clip that is already queued", () => {
    // Re-sending a bin you have grown by three must not duplicate the other
    // twenty.
    const first = queueToBlast(queue(), [clip()], "recall", 5000);
    const second = queueToBlast(first.queue, [clip()], "recall", 6000);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.queue.clips).toHaveLength(2);
  });

  it("heals a queued clip that was missing metadata", () => {
    // A clip queued before its pattern was known should be fixable by sending
    // it again, not by deleting and re-adding it.
    const first = queueToBlast(queue(), [clip()], "recall", 5000);
    expect(first.queue.clips[1]!.patternFamily).toBe("");

    const second = queueToBlast(
      first.queue,
      [clip({ patternId: "p1", patternName: "Identity claim", patternFamily: "identity" })],
      "recall",
      6000,
    );
    expect(second.healed).toBe(1);
    expect(second.added).toBe(0);
    expect(second.queue.clips[1]!.patternFamily).toBe("identity");
    expect(second.queue.clips[1]!.updatedAt).toBe(6000);
  });

  it("never overwrites metadata the queued clip already has", () => {
    // Overwriting would undo edits made in BLAST.
    const first = queueToBlast(queue(), [clip({ hookText: "the original hook" })], "recall", 5000);
    const second = queueToBlast(
      first.queue,
      [clip({ hookText: "a different hook" })],
      "recall",
      6000,
    );
    expect(second.queue.clips[1]!.hookText).toBe("the original hook");
    expect(second.healed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("never overwrites the caption text on a re-send", () => {
    // text is not in HANDOFF_META precisely because BLAST is where it gets
    // edited.
    const first = queueToBlast(queue(), [clip()], "recall", 5000);
    const edited = {
      ...first.queue,
      clips: first.queue.clips.map((c) =>
        c.key === "ep41@41@2" ? { ...c, text: "my edited caption" } : c,
      ),
    };
    const second = queueToBlast(edited, [clip()], "recall", 6000);
    expect(second.queue.clips[1]!.text).toBe("my edited caption");
    expect(HANDOFF_META).not.toContain("text");
  });

  it("skips a clip with no key rather than minting a keyless post", () => {
    // The key is the merge identity; a keyless clip would duplicate on sync.
    const r = queueToBlast(queue(), [{ key: "" }, clip()], "recall", 5000);
    expect(r.added).toBe(1);
    expect(r.queue.clips).toHaveLength(2);
  });

  it("trims the text and hook it was handed", () => {
    const r = queueToBlast(
      queue(),
      [clip({ text: "  padded caption  ", hookText: "  padded hook  " })],
      "recall",
      5000,
    );
    expect(r.queue.clips[1]!.text).toBe("padded caption");
    expect(r.queue.clips[1]!.hookText).toBe("padded hook");
  });

  it("defaults every map so BLAST can write into them immediately", () => {
    const q = queueToBlast(queue(), [clip()], "recall", 5000).queue.clips[1]!;
    for (const f of ["captions", "titles", "suggestions", "picked", "status"] as const) {
      expect(q[f], f).toEqual({});
    }
    expect(q.platforms).toBeNull();
  });

  it("adds several clips in one send", () => {
    const r = queueToBlast(
      queue(),
      [clip(), clip({ key: "ep41@60@3" }), clip({ key: "ep41@80@4" })],
      "recall",
      5000,
    );
    expect(r.added).toBe(3);
    expect(r.queue.clips).toHaveLength(4);
  });

  it("stamps the queue's updatedAt so a merge sees the change", () => {
    expect(queueToBlast(queue(), [clip()], "recall", 5000).queue.updatedAt).toBe(5000);
  });

  it("summarizes what actually happened", () => {
    expect(handoffSummary({ queue: queue(), added: 3, skipped: 0, healed: 0 })).toBe(
      "Queued 3 clips for BLAST",
    );
    expect(handoffSummary({ queue: queue(), added: 1, skipped: 2, healed: 1 })).toBe(
      "Queued 1 clip for BLAST (1 updated, 2 already queued)",
    );
  });
});

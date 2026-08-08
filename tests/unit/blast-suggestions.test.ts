import { describe, it, expect } from "vitest";
import {
  attachSuggestions,
  blankPost,
  clearPick,
  pickSuggestion,
  postingMarks,
  QUICK_KEY,
  startFreshPosting,
  suggestDesc,
  suggestLabel,
  suggestTitle,
  type BlastPost,
} from "../../src/domain/blast/queue";

function post(over: Partial<BlastPost> = {}): BlastPost {
  return blankPost(QUICK_KEY, over, 1000);
}

/**
 * The wiring between "the model returned options" and "the queue holds them".
 *
 * A code review found every defect here, because the suite covered the pure
 * parse/prompt halves and stopped at the seam between them. These pin the seam.
 */
describe("attaching generated options", () => {
  it("stores the options without touching the caption the user wrote", () => {
    // Silently replacing a hand-written caption is a destructive answer to
    // "show me some options".
    const p = attachSuggestions(post({ captions: { X: "mine" } }), { X: ["a", "b"] });
    expect(p.suggestions.X).toEqual(["a", "b"]);
    expect(p.captions.X).toBe("mine");
  });

  it("clears a stale pick rather than leaving it pointing into the old array", () => {
    // Regenerate with a smaller count and index 2 no longer exists — legacy
    // BLAST would highlight a chip that isn't there.
    const p = attachSuggestions(post({ suggestions: { X: ["a", "b", "c"] }, picked: { X: 2 } }), {
      X: ["only one"],
    });
    expect(p.picked.X).toBeUndefined();
  });

  it("leaves platforms the model skipped exactly as they were", () => {
    const before = post({ suggestions: { X: ["keep"] }, picked: { X: 0 } });
    const p = attachSuggestions(before, { TikTok: ["new"] });
    expect(p.suggestions.X).toEqual(["keep"]);
    expect(p.picked.X).toBe(0);
  });

  it("ignores an empty option list", () => {
    const p = attachSuggestions(post({ suggestions: { X: ["keep"] } }), { X: [] });
    expect(p.suggestions.X).toEqual(["keep"]);
  });
});

describe("picking an option", () => {
  it("writes the caption and records which one was chosen", () => {
    const p = pickSuggestion(post({ suggestions: { X: ["first", "second"] } }), "X", 1);
    expect(p.captions.X).toBe("second");
    expect(p.picked.X).toBe(1);
  });

  it("splits a Pinterest option into description and title", () => {
    // Legacy stores these in separate fields; fusing them would put the title
    // into Pinterest's description box.
    const p = pickSuggestion(
      post({ suggestions: { Pinterest: [{ title: "Punchy", description: "The body" }] } }),
      "Pinterest",
      0,
    );
    expect(p.captions.Pinterest).toBe("The body");
    expect(p.titles.Pinterest).toBe("Punchy");
  });

  it("caps a Pin title at 100 chars on the way in", () => {
    const p = pickSuggestion(
      post({ suggestions: { Pinterest: [{ title: "t".repeat(150), description: "d" }] } }),
      "Pinterest",
      0,
    );
    expect(p.titles.Pinterest).toHaveLength(100);
  });

  it("does nothing when the index doesn't exist", () => {
    const before = post({ suggestions: { X: ["a"] } });
    expect(pickSuggestion(before, "X", 5)).toBe(before);
  });

  it("typing your own caption clears the pick", () => {
    const p = clearPick(post({ picked: { X: 1 } }), "X");
    expect(p.picked.X).toBeUndefined();
  });
});

describe("reading either suggestion shape", () => {
  it("reads a plain string", () => {
    expect(suggestDesc("hello")).toBe("hello");
    expect(suggestTitle("hello")).toBe("");
    expect(suggestLabel("hello")).toBe("hello");
  });

  it("reads a Pinterest object", () => {
    const o = { title: "T", description: "D" };
    expect(suggestDesc(o)).toBe("D");
    expect(suggestTitle(o)).toBe("T");
    expect(suggestLabel(o)).toBe("T — D");
  });

  it("degrades a legacy string Pinterest suggestion to description-only", () => {
    expect(suggestDesc("legacy")).toBe("legacy");
    expect(suggestLabel("legacy")).toBe("legacy");
  });

  it("survives a missing option", () => {
    expect(suggestDesc(undefined)).toBe("");
    expect(suggestLabel(undefined)).toBe("");
  });
});

describe("starting a fresh posting session", () => {
  const marked = post({
    status: { X: "posted", TikTok: "copied" },
    postUrl: { X: "https://x.com/1" },
    postedAt: { X: 5000 },
    postedCaption: { X: "what went out" },
  });

  it("clears every posting mark the previous clip left", () => {
    // Leaving them made the grid claim platforms were already posted for a clip
    // that had never been posted anywhere, and PULSE then imported the new
    // captions against the OLD clip's URLs and timestamps.
    const p = startFreshPosting(marked);
    expect(p.status).toEqual({});
    expect(p.postUrl).toEqual({});
    expect(p.postedAt).toEqual({});
    expect(p.postedCaption).toEqual({});
  });

  it("keeps the captions and options — only the posting run is over", () => {
    const p = startFreshPosting({ ...marked, captions: { X: "cap" }, suggestions: { X: ["o"] } });
    expect(p.captions).toEqual({ X: "cap" });
    expect(p.suggestions).toEqual({ X: ["o"] });
  });

  it("reports what is carried, so posted marks can be confirmed first", () => {
    const marks = postingMarks(marked);
    expect(marks.carried.sort()).toEqual(["TikTok", "X"]);
    expect(marks.posted).toEqual(["X"]);
  });

  it("reports nothing carried on a clean clip", () => {
    expect(postingMarks(post()).carried).toEqual([]);
    expect(postingMarks(post({ status: { X: "none" } })).carried).toEqual([]);
  });
});

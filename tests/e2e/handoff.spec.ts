// Verifies the RECALL → BLAST flow end to end: bin a clip with pattern
// provenance, send it, and confirm BLAST receives it intact.
import { test, expect } from "@playwright/test";

const LIB = {
  sources: [{
    id: "ep41", title: "Episode 41",
    segments: [
      { t: "0:00:05", sec: 5, text: "Discipline is just remembering what you want." },
      { t: "0:00:41", sec: 41, text: "The hardest rep is the one nobody sees." },
    ],
  }],
  enabled: ["ep41"],
  bin: [{
    key: "ep41@41@1", srcId: "ep41", srcTitle: "Episode 41", t: "0:00:41", sec: 41,
    text: "The hardest rep is the one nobody sees.",
    hookText: "The hardest rep is the one nobody sees.",
    label: "proof", patternId: "p1", patternName: "Identity claim", patternFamily: "identity",
  }],
};

// One test, not many: the handoff is a sequence — bin, send, re-send, then read
// the result back on the other side of the app.
test("a binned RECALL clip reaches BLAST intact, once", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((lib) => {
    localStorage.setItem("recall_state_v2", JSON.stringify(lib));
  }, LIB);

  const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem("blast_queue_v1") ?? "null"));
  const body = () => page.locator("main").textContent().then((t) => t ?? "");

  await page.goto("#/recall", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "RECALL" }).waitFor();
  await page.locator("main").getByText(/CLIP BIN — 1/).waitFor();

  await test.step("sending the bin queues the clip with its provenance", async () => {
    await page.getByRole("button", { name: "SEND TO BLAST" }).click();
    await page.locator("main").getByText(/Queued 1 clip/).waitFor();

    const q1 = await queue();
    const sent = q1.clips.find((c: any) => c.key === "ep41@41@1");
    expect(!!sent, "the clip reaches the BLAST queue").toBeTruthy();
    expect(
      sent.srcTitle === "Episode 41" && sent.t === "0:00:41",
      "carries its source and timecode",
    ).toBeTruthy();
    expect(sent.patternFamily === "identity", "carries the pattern family PULSE will need").toBeTruthy();
    expect(sent.hookText === "The hardest rep is the one nobody sees.", "carries the hook").toBeTruthy();
    expect(q1.clips[0].key === "quick", "the Quick post is still first").toBeTruthy();
  });

  await test.step("Re-sending must not duplicate.", async () => {
    await page.getByRole("button", { name: "SEND TO BLAST" }).click();
    await page.locator("main").getByText(/already queued/).waitFor();
    const q2 = await queue();
    expect(
      q2.clips.filter((c: any) => c.key === "ep41@41@1").length === 1,
      "re-sending does not duplicate",
    ).toBeTruthy();
    expect((await body()).includes("already queued"), "says it was already queued").toBeTruthy();
  });

  await test.step("BLAST renders it, with its provenance.", async () => {
    await page.goto("#/blast", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "BLAST" }).waitFor();
    expect((await body()).includes("Episode 41"), "BLAST shows the queued clip").toBeTruthy();
    await page.getByRole("button", { name: "Episode 41", exact: true }).click();
    await page.waitForTimeout(250);
    expect((await body()).includes("identity"), "BLAST shows its pattern provenance").toBeTruthy();
    expect(
      (await page.getByPlaceholder(/only wrote one/).inputValue()).includes("hardest rep"),
      "BLAST seeds the caption from the clip",
    ).toBeTruthy();
  });

  expect(
    errors.length === 0,
    `no console or page errors — ${errors.slice(0, 3).join(" | ")}`,
  ).toBeTruthy();
});

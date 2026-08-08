// Phase 5 part 7 verification: the crop panel must cost nothing until asked.
// The ffmpeg core is ~31MB; if it is fetched on page load, or on mounting the
// panel, that is the whole point of lazy-loading defeated.
import { test, expect, type Locator } from "@playwright/test";

// One test, not many: the whole point is a single continuous recording of every
// request the page makes, across mount, file choice and unmount.
test("the crop panel fetches no ffmpeg engine until a transcode is actually asked for", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  // Record every vendor/ffmpeg request the page makes, at any point.
  const vendorHits: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("vendor/ffmpeg")) vendorHits.push(r.url());
  });

  // Locators that outlive the step that created them.
  let reformat: Locator;
  let panel: Locator;

  await page.goto("#/blast", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "BLAST" }).waitFor();

  await test.step("nothing from vendor/ffmpeg on page load", async () => {
    expect(
      vendorHits.length === 0,
      `nothing from vendor/ffmpeg on page load — ${vendorHits.join(" | ")}`,
    ).toBeTruthy();
  });

  await test.step("the toggle exists and the panel is not mounted yet", async () => {
    const toggle = page.getByRole("button", { name: "9:16 CROP", exact: true });
    expect((await toggle.count()) === 1, "the crop toggle is offered").toBeTruthy();
    expect(
      (await page.getByText("Centre-crops landscape footage").count()) === 0,
      "the panel is not mounted before the toggle",
    ).toBeTruthy();

    await toggle.click();
    await page.getByRole("heading", { name: "9:16 CROP" }).waitFor();
    expect(
      (await page.getByText("Centre-crops landscape footage").count()) === 1,
      "the panel mounts on toggle",
    ).toBeTruthy();
    expect(
      vendorHits.length === 0,
      `still nothing fetched from vendor/ffmpeg — ${vendorHits.join(" | ")}`,
    ).toBeTruthy();
  });

  await test.step("REFORMAT is disabled until a file is chosen", async () => {
    reformat = page.getByRole("button", { name: "REFORMAT TO 9:16" });
    expect(await reformat.isDisabled(), "reformat is disabled with no file").toBeTruthy();
  });

  await test.step("the media gate refuses a non-video", async () => {
    panel = page.locator("section", { has: page.getByRole("heading", { name: "9:16 CROP" }) });
    await panel.locator('input[type="file"]').setInputFiles({
      name: "transcript.srt",
      mimeType: "text/plain",
      buffer: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nhello\n"),
    });
    await page.waitForTimeout(200);
    expect(
      (await page.getByText("That file isn't video").count()) === 1,
      "refuses a non-video file",
    ).toBeTruthy();
    expect(await reformat.isDisabled(), "reformat stays disabled after a refused file").toBeTruthy();
    expect(
      vendorHits.length === 0,
      `a refused file fetched no engine — ${vendorHits.join(" | ")}`,
    ).toBeTruthy();
  });

  await test.step("an audio file is refused too: transcription takes audio, cropping does not", async () => {
    await panel.locator('input[type="file"]').setInputFiles({
      name: "voice.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from([0xff, 0xfb, 0x00, 0x00]),
    });
    await page.waitForTimeout(200);
    expect(
      (await page.getByText("That file isn't video").count()) === 1,
      "refuses an audio file",
    ).toBeTruthy();
  });

  await test.step("a video file is accepted and enables the button, still without loading", async () => {
    await panel.locator('input[type="file"]').setInputFiles({
      name: "episode-41.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
    });
    await page.waitForTimeout(200);
    expect((await page.getByText("episode-41.mp4").count()) === 1, "accepts a video file").toBeTruthy();
    expect(
      (await page.getByText("That file isn't video").count()) === 0,
      "clears the earlier error",
    ).toBeTruthy();
    expect(await reformat.isEnabled(), "reformat is enabled once a video is chosen").toBeTruthy();
    expect(
      vendorHits.length === 0,
      `choosing a file still fetches no engine — ${vendorHits.join(" | ")}`,
    ).toBeTruthy();
  });

  await test.step("unmounting releases: the panel goes away cleanly", async () => {
    await page.getByRole("button", { name: "HIDE 9:16 CROP" }).click();
    await page.waitForTimeout(200);
    expect(
      (await page.getByText("Centre-crops landscape footage").count()) === 0,
      "the panel unmounts on toggle",
    ).toBeTruthy();
  });

  // The suite deliberately never presses REFORMAT: a real wasm transcode would
  // take minutes and prove nothing the argument-vector unit test doesn't.

  expect(
    errors.length === 0,
    `no console or page errors — ${errors.slice(0, 3).join(" | ")}`,
  ).toBeTruthy();
});

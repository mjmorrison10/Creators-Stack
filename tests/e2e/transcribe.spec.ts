// Verifies the upload → transcribe → parse → source path with the AI endpoint
// stubbed by network interception (ES module bindings can't be monkey-patched).
import { test, expect } from "@playwright/test";

/** The legacy library envelope, as it sits in IndexedDB under `library/current`. */
type LegacyLibrary = {
  sources: { id: string; title: string; segments: { t: string; sec: number; text: string }[] }[];
  enabled: string[];
  bin: { key: string }[];
};

const FAKE_TRANSCRIPT = [
  "[00:00:05] Discipline is just remembering what you want.",
  "[00:00:22] Confidence comes after the work, never before it.",
  "[00:00:41] The hardest rep is the one nobody sees.",
].join("\n");

// One test, not many: the same dialog is fed three files in sequence, and each
// assertion is about what the *previous* upload did or did not do.
test("RECALL transcribes media through the stubbed provider and parses it", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  let generateCalls = 0;
  let sawPrompt = "";
  await page.route("**generativelanguage.googleapis.com/**", async (route) => {
    const url = route.request().url();
    if (url.includes(":generateContent")) {
      generateCalls++;
      try {
        const body = JSON.parse(route.request().postData() ?? "{}");
        sawPrompt = JSON.stringify(body);
      } catch { /* body shape is asserted below, not here */ }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text: FAKE_TRANSCRIPT }] }, finishReason: "STOP" }],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.addInitScript(() => {
    localStorage.setItem("stack_settings_v1", JSON.stringify({ geminiKey: "test-key-not-real" }));
    localStorage.setItem("recall_state_v2", JSON.stringify({ sources: [], enabled: [], bin: [] }));
  });

  await page.goto("#/recall", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "RECALL" }).waitFor();
  await page.getByRole("button", { name: "+ ADD SOURCE" }).click();
  await page.getByRole("dialog").waitFor();

  const dialog = () => page.getByRole("dialog").textContent().then((t) => t ?? "");

  expect(
    (await dialog()).includes("Gemini"),
    "names the provider that will do the transcribing",
  ).toBeTruthy();

  // --- a text file is read straight in, never sent to a provider ---
  await test.step("a text file is read straight in, never sent to a provider", async () => {
    await page.getByRole("dialog").locator(String.raw`input[type="file"]`).setInputFiles({
      name: "pasted.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        ["1", "00:00:01,000 --> 00:00:03,000", "Read locally, never uploaded.", ""].join("\n"),
      ),
    });
    await page.waitForTimeout(300);
    expect(generateCalls === 0, "reads a text file locally without calling the provider").toBeTruthy();
    expect(
      (await page.getByPlaceholder("e.g. Podcast ep. 41").inputValue()) === "pasted",
      "derives a title from the filename",
    ).toBeTruthy();
    expect((await dialog()).includes("SRT / WebVTT cues"), "parses the text file it read").toBeTruthy();
  });

  // --- an unsupported type is refused, not sent as fake audio ---
  await test.step("an unsupported type is refused, not sent as fake audio", async () => {
    await page.getByRole("dialog").locator(String.raw`input[type="file"]`).setInputFiles({
      name: "archive.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("not media"),
    });
    await page.waitForTimeout(300);
    expect((await dialog()).includes("audio and video only"), "refuses an unsupported file").toBeTruthy();
    expect(generateCalls === 0, "never sends a non-media file to the provider").toBeTruthy();
  });

  // --- media goes to the provider and comes back parsed ---
  await test.step("media goes to the provider and comes back parsed", async () => {
    await page.getByRole("dialog").locator(String.raw`input[type="file"]`).setInputFiles({
      name: "episode41.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("fake audio bytes"),
    });
    await page.locator("main").getByText(/MOMENTS$/).waitFor({ timeout: 20000 });
    expect(generateCalls === 1, "calls the provider exactly once for the media file").toBeTruthy();
    expect(
      sawPrompt.includes("[HH:MM:SS]") && sawPrompt.includes("VERBATIM"),
      "sends the verbatim-transcript prompt",
    ).toBeTruthy();
    expect(
      sawPrompt.includes("inline_data") || sawPrompt.includes("inlineData") || sawPrompt.includes("file_data") || sawPrompt.includes("fileData"),
      "sends the audio inline, not as text",
    ).toBeTruthy();

    const afterMedia = await dialog();
    expect(/3 MOMENTS/.test(afterMedia), "parses the returned transcript into moments").toBeTruthy();
    expect(afterMedia.includes("Discipline is just remembering"), "previews what it parsed").toBeTruthy();
  });

  await test.step("the transcribed source is saved", async () => {
    await page.getByRole("button", { name: "ADD SOURCE", exact: true }).click();
    await page.waitForTimeout(400);

    const lib = await page.evaluate(
      () =>
        new Promise<LegacyLibrary | null>((res) => {
          const r = indexedDB.open("recall", 1);
          r.onsuccess = () => {
            const g = r.result.transaction("library", "readonly").objectStore("library").get("current");
            g.onsuccess = () => res(g.result ?? null);
          };
        }),
    );
    expect(lib!.sources.length === 1, "saves the transcribed source").toBeTruthy();
    expect(lib!.sources[0]!.segments.length === 3, "stores its parsed segments").toBeTruthy();
    // [00:00:05] keeps its hour digits; "0:00:05" is what a two-part timecode
    // like [0:05] normalizes to. Both are valid legacy output.
    expect(lib!.sources[0]!.segments[0]!.t === "00:00:05", "segments carry normalized timecodes").toBeTruthy();
    expect(
      lib!.sources[0]!.segments[1]!.sec === 22,
      "segments carry seconds matching the timecode",
    ).toBeTruthy();
    expect(
      lib!.enabled.includes(lib!.sources[0]!.id),
      "the transcribed source is switched on",
    ).toBeTruthy();
  });

  expect(errors.length === 0, "no console or page errors").toBeTruthy();
});

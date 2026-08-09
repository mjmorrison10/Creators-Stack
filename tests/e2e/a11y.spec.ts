import { test, expect } from "@playwright/test";

/**
 * Keyboard and screen-reader behavior, driven rather than inspected.
 *
 * Every check here is for something that was previously *claimed* by markup
 * and not actually true: tabs that announced arrow-key navigation they didn't
 * implement, a dialog that said `aria-modal` while Tab walked out of it, and
 * status lines carrying `role="status"` that could never announce because
 * they mounted together with their text.
 */

test("the tab strips behave the way their roles promise", async ({ page }) => {
  await page.goto("#/hooklab");
  await page.getByRole("heading", { name: "HOOKLAB" }).waitFor();

  const tabs = page.getByRole("tab");
  expect((await tabs.count()) === 3, "three tabs").toBeTruthy();

  await test.step("exactly one tab is in the tab sequence", async () => {
    // Roving tabindex: without it, Tab walks through every tab before
    // reaching the panel, which is the thing the pattern exists to avoid.
    const indexes = await tabs.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).tabIndex),
    );
    expect(
      indexes.filter((i) => i === 0).length === 1,
      `one tabbable tab, got ${JSON.stringify(indexes)}`,
    ).toBeTruthy();
  });

  await test.step("arrow keys move selection, and wrap", async () => {
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    expect(
      (await page.getByRole("tab", { selected: true }).textContent())?.includes("LEDGER"),
      "Right moves to the next tab",
    ).toBeTruthy();

    await page.keyboard.press("ArrowLeft");
    expect(
      (await page.getByRole("tab", { selected: true }).textContent())?.includes("GENERATE"),
      "Left moves back",
    ).toBeTruthy();

    await page.keyboard.press("ArrowLeft");
    expect(
      (await page.getByRole("tab", { selected: true }).textContent())?.includes("BANK"),
      "and Left from the first wraps to the last",
    ).toBeTruthy();

    await page.keyboard.press("Home");
    expect(
      (await page.getByRole("tab", { selected: true }).textContent())?.includes("GENERATE"),
      "Home returns to the first",
    ).toBeTruthy();
  });

  await test.step("the selected tab points at a panel that is really there", async () => {
    // Only the selected tab carries aria-controls, because the others'
    // panels are unmounted and a reference to a missing id is a dangling
    // pointer for assistive tech.
    const id = await page
      .getByRole("tab", { selected: true })
      .getAttribute("aria-controls");
    expect(!!id, "the selected tab names its panel").toBeTruthy();
    expect(
      (await page.locator(`[id="${id}"]`).count()) === 1,
      `panel ${id} exists in the document`,
    ).toBeTruthy();

    const unselected = await page
      .getByRole("tab", { selected: false })
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-controls")));
    expect(
      unselected.every((v) => v === null),
      "and the unselected tabs point at nothing rather than at a missing id",
    ).toBeTruthy();

    expect(
      (await page.getByRole("tabpanel").count()) === 1,
      "exactly one panel is exposed at a time",
    ).toBeTruthy();
  });

  await test.step("RECALL's strip got the same treatment", async () => {
    await page.goto("#/recall");
    await page.getByRole("heading", { name: "RECALL" }).waitFor();
    // Polled rather than counted once: this is a same-document hash
    // navigation, so the heading can be present a beat before the rest of
    // the section has committed.
    await expect.poll(() => page.getByRole("tab").count(), { message: "two tabs" }).toBe(2);
    await expect
      .poll(() => page.getByRole("tabpanel").count(), { message: "and a real panel" })
      .toBe(1);
  });
});

test("the skip link moves focus without destroying the route", async ({ page }) => {
  // The trap this exists for: the app is hash-routed, so a skip link written
  // the usual way — href="#main" — overwrites the route and sends the creator
  // from #/pulse to the unknown-route fallback.
  await page.goto("#/pulse");
  await page.getByRole("heading", { name: "PULSE" }).waitFor();

  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  expect(first === "SKIP TO CONTENT", `the skip link is first in the tab order, got "${first}"`)
    .toBeTruthy();

  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => document.activeElement?.id === "main"),
    "focus lands on main",
  ).toBeTruthy();
  expect(page.url().includes("#/pulse"), `the route survived — url is ${page.url()}`).toBeTruthy();
  await page.getByRole("heading", { name: "PULSE" }).waitFor();
});

test("a modal traps focus, restores it, and closes on the backdrop", async ({ page }) => {
  await page.goto("#/recall");
  await page.getByRole("heading", { name: "RECALL" }).waitFor();

  const trigger = page.getByRole("button", { name: "+ ADD SOURCE" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();

  await test.step("Tab cycles inside the dialog rather than escaping it", async () => {
    // Twenty presses is well past the number of controls in this dialog, so
    // an untrapped Tab would certainly have reached the page behind by now.
    for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d && !!document.activeElement && d.contains(document.activeElement);
    });
    expect(inside, "focus is still inside the dialog after 20 tabs").toBeTruthy();
  });

  await test.step("Shift+Tab does too", async () => {
    for (let i = 0; i < 20; i++) await page.keyboard.press("Shift+Tab");
    const inside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d && !!document.activeElement && d.contains(document.activeElement);
    });
    expect(inside, "focus is still inside the dialog going backwards").toBeTruthy();
  });

  await test.step("clicking the backdrop cancels", async () => {
    // Top-left corner of the viewport is backdrop, never the centered panel.
    await page.mouse.click(5, 5);
    expect((await page.getByRole("dialog").count()) === 0, "the dialog closed").toBeTruthy();
  });

  await test.step("and focus returns to the button that opened it", async () => {
    // Restoration is deferred one tick, because the click that closed the
    // dialog is still in flight and would otherwise land focus on <body>.
    await expect
      .poll(async () => page.evaluate(() => document.activeElement?.textContent?.trim()))
      .toBe("+ ADD SOURCE");
  });
});

test("status messages reach a live region that was already there", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "recall_state_v2",
      JSON.stringify({
        sources: [
          {
            id: "ep1",
            title: "Episode 1",
            segments: [{ t: "0:00:10", sec: 10, text: "the hardest rep is the quiet one" }],
          },
        ],
        enabled: ["ep1"],
        bin: [
          {
            key: "ep1@10@0",
            srcId: "ep1",
            srcTitle: "Episode 1",
            t: "0:00:10",
            sec: 10,
            text: "the hardest rep is the quiet one",
          },
        ],
      }),
    );
  });

  await page.goto("#/recall");
  await page.getByRole("heading", { name: "RECALL" }).waitFor();

  const polite = page.locator('[aria-live="polite"]');
  expect((await polite.count()) === 1, "one polite region, mounted at boot").toBeTruthy();
  expect(
    (await polite.textContent())?.trim() === "",
    "and empty before anything is announced — a region that arrives WITH its text never announces",
  ).toBeTruthy();

  await page.getByRole("button", { name: "SEND TO BLAST" }).click();
  // Two matches now, and that IS the assertion: the visible status line
  // and the live region that announced it.
  await page.getByText(/Queued 1 clip/).first().waitFor();
  expect(
    (await polite.textContent())?.includes("Queued 1 clip"),
    `the confirmation was announced, not just drawn — region says "${await polite.textContent()}"`,
  ).toBeTruthy();
});

test("the app honors a reduced-motion preference", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL });
  try {
    const page = await ctx.newPage();
    await page.goto("#/blast");
    await page.getByRole("heading", { name: "BLAST" }).waitFor();
    // The app puts `transition` on nav links, tabs, cards and buttons. Under
    // the preference those must resolve to effectively instant.
    const durations = await page.evaluate(() =>
      [...document.querySelectorAll("button, a")]
        .slice(0, 40)
        .map((el) => getComputedStyle(el).transitionDuration),
    );
    expect(durations.length > 0, "there are transitioning elements to check").toBeTruthy();
    // Compared numerically: the computed value serializes as "1e-05s", not
    // the "0.01ms" the stylesheet declares.
    const seconds = durations.map((d) => parseFloat(d));
    expect(
      seconds.every((s) => s <= 0.001),
      `every transition is instant, got ${[...new Set(durations)].join(", ")}`,
    ).toBeTruthy();
  } finally {
    await ctx.close();
  }
});

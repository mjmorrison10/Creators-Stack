// Verifies the two review fixes that only manifest in the browser.
import { test, expect } from "@playwright/test";

// One test, not many: FIX 2 asserts on the state FIX 1 left the form in, and
// FIX 3 depends on having already visited the BANK tab.
test("HOOKLAB review fixes: one-shot prefill, error-toned validation, working TEXT-NATIVE filter", async ({ page }) => {
  await page.goto("#/hooklab", { waitUntil: "networkidle" });

  await test.step("FIX 1: prefill must be one-shot, not sticky across revisits.", async () => {
    await page.getByPlaceholder("e.g. why most hooks fail").fill("test topic");
    await page.getByRole("button", { name: "UNDERWRITE HOOKS" }).click();
    await page.locator("main").getByText(/RESULTS —/).waitFor();
    const card = page.locator("li").filter({ has: page.getByRole("button", { name: "LOG OUTCOME" }) }).first();
    const hookText = (await card.locator("p").first().textContent()) ?? "";
    await card.getByRole("button", { name: "LOG OUTCOME" }).click();

    await page.locator("main").getByText("LOG AN OUTCOME").waitFor();
    const seeded = await page.getByPlaceholder("The opening line you used").inputValue();
    expect(seeded === hookText.trim(), "prefill carries the hook into the form").toBeTruthy();

    await page.getByRole("button", { name: "LOG ENTRY" }).click();
    await page.locator("main").getByText("Logged.").waitFor();

    // Leave and come back — the form must be blank, not re-seeded with the old hook.
    await page.getByRole("tab", { name: "BANK" }).click();
    await page.locator("main").getByText(/PATTERN BANK —/).waitFor();
    await page.getByRole("tab", { name: /LEDGER/ }).click();
    await page.locator("main").getByText("LOG AN OUTCOME").waitFor();
    const afterRevisit = await page.getByPlaceholder("The opening line you used").inputValue();
    expect(afterRevisit === "", `revisiting LEDGER starts blank (got "${afterRevisit}")`).toBeTruthy();
  });

  await test.step("FIX 2: a validation error must render in the error tone, not as success.", async () => {
    await page.getByRole("button", { name: "LOG ENTRY" }).click();

    // Phase 8 moved the ARIA role off the status line: a live region that
    // mounts WITH its message never announces, so `role="alert"` here was
    // decoration. The announcement now goes to the boot-mounted assertive
    // region, and the tone is still carried visually. Both are asserted.
    const line = page.locator("main").getByText(/Hook text is required/);
    expect((await line.count()) === 1, "the validation message is shown").toBeTruthy();
    const cls = await line.getAttribute("class");
    expect(cls?.includes("text-gold"), `error is styled as an error, not success (${cls})`).toBeTruthy();
    expect(
      (await page.locator('[aria-live="assertive"]').textContent())?.includes(
        "Hook text is required",
      ),
      "and it is announced assertively, because continuing would waste the creator's time",
    ).toBeTruthy();
  });

  await test.step("FIX 3: the TEXT-NATIVE chip must actually match patterns now.", async () => {
    await page.getByRole("tab", { name: "BANK" }).click();
    await page.locator("main").getByText(/PATTERN BANK —/).waitFor();
    await page.getByRole("button", { name: "TEXT-NATIVE", exact: true }).click();
    await page.waitForTimeout(150);
    const shown = (await page.locator("main").getByText(/^SHOWING \d+$/).textContent()) ?? "";
    const count = Number(shown.replace(/\D/g, ""));
    expect(count > 0, `TEXT-NATIVE filter matches patterns (${shown.trim()})`).toBeTruthy();
  });
});

import { test, expect } from "@playwright/test";

/**
 * The installable-app half of Phase 8.
 *
 * The load-bearing assertion here is the negative one: `public/vendor` is
 * ~31MB of ffmpeg wasm, and precaching it would make every install download
 * the crop engine whether or not the creator ever crops anything — on a
 * phone, on cellular. CropPanel's entire design is to fetch that core only
 * when the panel opens, and `crop.spec.ts` asserts no vendor request happens
 * on load. A precache manifest that swept it in would defeat both without
 * either of those tests noticing, because the service worker fetches it
 * behind their backs.
 *
 * The suite blocks service workers globally (a registered SW caches across
 * runs and makes assertions depend on run order), so this spec opts back in.
 */
test.use({ serviceWorkers: "allow" });

test("installs as an app without dragging 31MB of ffmpeg along", async ({ page, baseURL }) => {
  await test.step("the manifest is linked and describes the unified app", async () => {
    await page.goto("./");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href, "index.html links a manifest").toBeTruthy();
    // Base-path correctness is the recurring Pages bug in this project: an
    // absolute "/manifest.webmanifest" would 404 on a project site.
    expect(href!.startsWith("/Creators-Stack/"), "resolved against the project base").toBeTruthy();

    const res = await page.request.get(href!);
    expect(res.ok(), "and it actually serves").toBeTruthy();
    const manifest = (await res.json()) as {
      name: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.name === "THE STACK", "named for the whole stack").toBeTruthy();
    expect(manifest.display === "standalone", "installs standalone").toBeTruthy();
    expect(
      manifest.icons.some((i) => i.sizes === "192x192") &&
        manifest.icons.some((i) => i.sizes === "512x512"),
      "with both icon sizes an install prompt needs",
    ).toBeTruthy();

    for (const icon of manifest.icons) {
      const iconRes = await page.request.get(new URL(icon.src, `${baseURL}`).toString());
      expect(iconRes.ok(), `icon ${icon.src} resolves`).toBeTruthy();
    }
  });

  await test.step("the precache manifest excludes vendor/ entirely", async () => {
    const sw = await page.request.get("sw.js");
    expect(sw.ok(), "a service worker was generated").toBeTruthy();
    const src = await sw.text();

    // Read the actual precache list rather than grepping the whole file: the
    // navigateFallbackDenylist legitimately mentions vendor, and a bare grep
    // would either pass vacuously or fail on the wrong thing.
    const list = src.match(/\[\{[^\]]*revision[^\]]*\}\]/);
    expect(!!list, "the precache manifest is present in sw.js").toBeTruthy();
    const urls = [...list![0].matchAll(/url:"([^"]+)"/g)].map((m) => m[1]!);
    expect(urls.length > 0, "and it is not empty").toBeTruthy();
    expect(
      urls.every((u) => !u.includes("vendor")),
      `no vendor asset is precached — found: ${urls.filter((u) => u.includes("vendor")).join(", ")}`,
    ).toBeTruthy();

    // The app shell that IS worth precaching.
    expect(urls.includes("index.html"), "the shell is precached").toBeTruthy();
    expect(
      urls.some((u) => u.endsWith(".js") && u.startsWith("assets/")),
      "along with the hashed bundle",
    ).toBeTruthy();
  });

  await test.step("the worker registers against a real preview server", async () => {
    await page.goto("./");
    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? reg.scope : null;
    });
    expect(registered, "a service worker registration exists").toBeTruthy();
    expect(
      registered!.endsWith("/Creators-Stack/"),
      `scoped to the project base, not the origin root — got ${registered}`,
    ).toBeTruthy();
  });
});

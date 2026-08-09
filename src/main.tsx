import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { KEYS } from "./data/keys";
import { readRaw, writeJSON } from "./data/storage";
import { applyTheme, seedThemeFromLegacy, type Theme } from "./features/settings/ThemeControl";
import "./index.css";

// Apply the theme before first paint, or the app flashes the wrong palette.
// On a device that used the old apps, adopt whichever theme they had rather
// than resetting the user to system default.
function bootTheme(): void {
  const stored = readRaw(KEYS.stackTheme);
  if (stored) {
    try {
      applyTheme(JSON.parse(stored) as Theme);
      return;
    } catch {
      /* fall through to seeding */
    }
  }
  const seeded = seedThemeFromLegacy();
  if (seeded) {
    writeJSON(KEYS.stackTheme, seeded);
    applyTheme(seeded);
  }
}
bootTheme();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing from index.html");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

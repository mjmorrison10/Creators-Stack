import { useEffect } from "react";
import { Button, Card } from "../../components/ui";
import { KEYS } from "../../data/keys";
import { useStackKey } from "../../data/hooks";
import { readRaw } from "../../data/storage";

export type Theme = "system" | "light" | "dark";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "SYSTEM" },
  { value: "light", label: "LIGHT" },
  { value: "dark", label: "DARK" },
];

/**
 * The four legacy apps each kept their own theme key. This app has one, seeded
 * once from whichever legacy key exists so an existing user doesn't land in a
 * theme they never chose. The legacy keys are read, never written — those apps
 * are still deployed and keep their own preference.
 */
export function seedThemeFromLegacy(): Theme | null {
  for (const key of [KEYS.hooklabTheme, KEYS.blastTheme, KEYS.pulseTheme]) {
    const raw = readRaw(key);
    if (raw === "dark" || raw === "light") return raw;
    // Some were written as JSON strings rather than bare values.
    if (raw === '"dark"') return "dark";
    if (raw === '"light"') return "light";
  }
  return null;
}

/** Apply to the document root, where the CSS custom properties key off it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function ThemeControl() {
  const [theme, setTheme] = useStackKey<Theme>(KEYS.stackTheme, "system");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <Card title="THEME" hint="Applies to this device only — themes are never synced.">
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <Button
            key={o.value}
            variant={theme === o.value ? "primary" : "default"}
            onClick={() => setTheme(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

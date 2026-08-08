import { useRef, type ReactNode } from "react";

/**
 * A tab strip that behaves like one.
 *
 * RECALL and HOOKLAB both had `role="tab"` buttons with no `tabpanel` to
 * point at and no arrow-key movement. That is worse than plain buttons: a
 * screen reader announces "tab, 1 of 3" and a keyboard user then presses the
 * arrow keys the announcement just promised, and nothing happens. Either
 * commit to the pattern or drop the role — this commits, once, in one place.
 *
 * Roving tabindex per APG: exactly one tab is in the tab sequence, and the
 * arrows move between them. Tab itself leaves the strip and lands in the
 * panel, which is the entire point of the pattern.
 */
export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Optional trailing count, e.g. the ledger size. */
  badge?: ReactNode;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  accentClass,
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Names the strip for assistive tech, e.g. "RECALL views". */
  label: string;
  /** Section accent for the selected tab, e.g. "border-recall text-recall". */
  accentClass: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  const move = (dir: -1 | 1 | "first" | "last"): void => {
    const i = tabs.findIndex((t) => t.id === active);
    const next =
      dir === "first"
        ? 0
        : dir === "last"
          ? tabs.length - 1
          : // Wraps, per the APG: from the last tab, Right returns to the first.
            (i + dir + tabs.length) % tabs.length;
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    // Selection follows focus here, which is right for these strips: every
    // panel is already rendered client-side, so there is no cost to landing
    // on one, and it keeps arrow-key browsing to a single keystroke.
    stripRef.current?.querySelector<HTMLElement>(`#tab-${label}-${target.id}`)?.focus();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      className="mb-5 flex flex-wrap gap-2"
      onKeyDown={(e) => {
        const key = e.key;
        if (key === "ArrowRight") move(1);
        else if (key === "ArrowLeft") move(-1);
        else if (key === "Home") move("first");
        else if (key === "End") move("last");
        else return;
        e.preventDefault();
      }}
    >
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            id={`tab-${label}-${t.id}`}
            role="tab"
            aria-selected={on}
            // Only on the selected tab: inactive panels are unmounted, and
            // aria-controls pointing at an id that is not in the document is
            // a dangling reference — assistive tech is told to look for
            // something that isn't there.
            aria-controls={on ? `panel-${label}-${t.id}` : undefined}
            // Roving tabindex: only the selected tab is tabbable, so Tab
            // moves OUT of the strip rather than through every tab in it.
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`rounded-lg border px-3 py-2 font-mono text-[11px] font-bold tracking-[0.08em] transition ${
              on ? `${accentClass} bg-surface2` : "border-edge text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.badge != null && <span className="ml-1.5 text-faint">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a tab controls. Focusable so Tab out of the strip lands here. */
export function TabPanel({
  id,
  label,
  active,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${label}-${id}`}
      aria-labelledby={`tab-${label}-${id}`}
      tabIndex={0}
      className="outline-none"
    >
      {children}
    </div>
  );
}

import { NavLink, Outlet } from "react-router-dom";
import { SECTIONS } from "./sections";

/**
 * Replaces the old stacknav.js bar: what used to be four separate sites behind
 * a link bar is now in-app routing. Same names, same accents, no page loads.
 */
function StackNav() {
  const base =
    "px-3 py-1.5 rounded-full text-[11px] font-bold tracking-[0.08em] transition-colors";
  return (
    <nav
      aria-label="Sections"
      className="flex flex-wrap items-center justify-center gap-1.5 border-b border-edge bg-surface/60 px-3 py-2 font-mono"
    >
      <span className="mr-1 text-[10px] font-semibold tracking-[0.14em] text-faint">
        THE STACK
      </span>
      {SECTIONS.map((s) => (
        <NavLink
          key={s.key}
          to={s.path}
          className={({ isActive }) =>
            isActive
              ? `${base} bg-surface2 ${s.accent}`
              : `${base} text-muted hover:text-ink`
          }
        >
          {s.name}
        </NavLink>
      ))}
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          isActive
            ? `${base} bg-surface2 text-ink`
            : `${base} text-muted hover:text-ink`
        }
      >
        SETTINGS
      </NavLink>
    </nav>
  );
}

export function AppLayout() {
  return (
    <div className="min-h-dvh">
      <StackNav />
      <main className="mx-auto w-full max-w-[1180px] px-5 pt-6 pb-32">
        <Outlet />
      </main>
    </div>
  );
}

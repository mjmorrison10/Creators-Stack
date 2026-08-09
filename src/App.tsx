import { NavLink, Outlet } from "react-router-dom";
import { SECTIONS } from "./sections";
import { LiveRegion } from "./components/LiveRegion";

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
      {/* First thing in the tab order, visible only once focused. The nav is
          five links on every single route, and without this a keyboard user
          pays that toll on every navigation. */}
      {/* A button, not `href="#main"`. This app is hash-routed, so an anchor
          to a fragment would overwrite the route — the skip link would send
          the creator from #/pulse to the unknown-route fallback, which is a
          far worse experience than no skip link at all. */}
      <button
        type="button"
        onClick={() => document.getElementById("main")?.focus()}
        className="sr-only rounded-lg border border-edge bg-surface px-3 py-2 font-mono text-[11px] tracking-[0.08em] text-ink focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50"
      >
        SKIP TO CONTENT
      </button>
      {/* Mounted at boot and empty until something is said — a live region
          that arrives WITH its message never announces. */}
      <LiveRegion />
      <StackNav />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1180px] px-5 pt-6 pb-32">
        <Outlet />
      </main>
    </div>
  );
}

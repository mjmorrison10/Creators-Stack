interface SectionHeaderProps {
  name: string;
  tagline: string;
  accent: string;
}

export function SectionHeader({ name, tagline, accent }: SectionHeaderProps) {
  return (
    <header className="mb-6">
      <h1
        className={`font-mono text-xl font-bold tracking-[0.26em] ${accent}`}
      >
        {name}
      </h1>
      <p className="mt-1.5 text-sm text-muted">{tagline}</p>
    </header>
  );
}

/**
 * Phase 0 placeholder. Each section replaces this with its real UI in the
 * phase that ports it (HOOKLAB 3, RECALL 4, BLAST 5, PULSE 6).
 */
export function ComingInPhase({ phase, items }: { phase: number; items: string[] }) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-5 shadow-card">
      <p className="font-mono text-[11px] tracking-[0.14em] text-faint">
        PHASE {phase}
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-muted">
        {items.map((it) => (
          <li key={it} className="flex gap-2">
            <span aria-hidden="true" className="text-faint">
              &middot;
            </span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

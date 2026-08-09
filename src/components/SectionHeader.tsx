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

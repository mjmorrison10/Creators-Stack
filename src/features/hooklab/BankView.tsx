import { useMemo, useState } from "react";
import { Card, TextInput } from "../../components/ui";
import {
  countByTier,
  HISTORICAL_INSTANCES,
  MECHANISMS,
  PATTERNS,
  type Tier,
} from "../../domain/hooklab/patterns";

/**
 * Filters, not strictly tiers. The source comments describe a "text-native"
 * group, but no pattern carries that as a tier — those are core/extended
 * patterns whose only medium is text. Keying the chip on tier matched nothing,
 * so it keys on medium, which is what the group actually means.
 */
type Filter = Tier | "all" | "text-only";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "core", label: "CORE" },
  { id: "extended", label: "EXTENDED" },
  { id: "historical", label: "HISTORICAL" },
  { id: "text-only", label: "TEXT-NATIVE" },
];

export function BankView() {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<Filter>("all");
  const [mechanism, setMechanism] = useState("all");

  const counts = useMemo(() => countByTier(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PATTERNS.filter((p) => {
      if (tier === "text-only") {
        if (p.mediums.includes("video")) return false;
      } else if (tier !== "all" && p.tier !== tier) {
        return false;
      }
      if (mechanism !== "all" && p.mechanism !== mechanism) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.scaffold.toLowerCase().includes(q) ||
        p.family.toLowerCase().includes(q) ||
        p.why.toLowerCase().includes(q)
      );
    });
  }, [query, tier, mechanism]);

  const chip = (active: boolean): string =>
    `rounded-full border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] transition ${
      active ? "border-brand bg-brand-ghost text-brand" : "border-edge text-muted hover:text-ink"
    }`;

  return (
    <>
      <Card
        title={`PATTERN BANK — ${PATTERNS.length} PATTERNS`}
        hint="The structures HOOKLAB underwrites from. AI fills slots; it never invents the set."
      >
        <p className="mb-4 font-mono text-[11px] tracking-[0.08em] text-faint">
          {Object.entries(counts)
            .filter(([k]) => k !== "total" && k !== "instances")
            .map(([k, v]) => `${v} ${k}`)
            .join(" · ")}
        </p>

        <div className="mb-4">
          <TextInput value={query} onChange={setQuery} placeholder="Search patterns…" />
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setTier(f.id)} className={chip(tier === f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMechanism("all")}
            className={chip(mechanism === "all")}
          >
            ALL MECHANISMS
          </button>
          {MECHANISMS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMechanism(m.id)}
              className={chip(mechanism === m.id)}
              title={m.job}
            >
              {m.name}
            </button>
          ))}
        </div>
      </Card>

      <Card title={`SHOWING ${filtered.length}`}>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted">No pattern matches that filter.</p>
        ) : (
          <ul className="space-y-3">
            {filtered.map((p) => (
              <li key={p.id} className="rounded-xl border border-edge bg-surface2 p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
                    {p.family} · {p.tier} · strength {p.strength}
                  </span>
                </div>
                {/* The scaffold with its slots visible — the point is the shape. */}
                <p className="font-mono text-[13px] leading-snug text-brand">{p.scaffold}</p>
                <p className="mt-2 text-xs text-muted">{p.why}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={`HISTORICAL EVIDENCE — ${HISTORICAL_INSTANCES.length}`}
        hint="Documented campaigns behind the patterns. Evidence, not extra candidates."
      >
        <ul className="space-y-3">
          {HISTORICAL_INSTANCES.map((h) => (
            <li key={h.id} className="rounded-xl border border-edge bg-surface2 p-4">
              <p className="text-sm font-semibold text-ink">
                {h.title} <span className="font-normal text-faint">· {h.year}</span>
              </p>
              <p className="mt-1 text-xs text-muted">{h.mechanismNote}</p>
              <p className="mt-1.5 text-xs text-faint">Modern parallel: {h.modernParallel}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

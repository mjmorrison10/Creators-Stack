import { Link } from "react-router-dom";
import { SECTIONS, type SectionKey } from "../sections";

/**
 * The "now go there" half of a cross-section handoff.
 *
 * Every handoff used to end in prose — "open BLAST to write captions" — which
 * told the creator what to do without giving them a way to do it. Four
 * sections used to be four websites; the whole point of merging them is that
 * the next step is one click away.
 *
 * Deliberately a LINK rather than an automatic redirect: sending twenty clips
 * to BLAST is often the middle of a batch, and yanking the page out from under
 * someone mid-flow is worse than an extra click.
 */
export function HandoffLink({ to }: { to: SectionKey }) {
  const section = SECTIONS.find((s) => s.key === to);
  if (!section) return null;
  return (
    <Link
      to={section.path}
      className={`ml-2 whitespace-nowrap font-mono text-[11px] font-bold tracking-[0.08em] underline ${section.accent}`}
    >
      OPEN {section.name} →
    </Link>
  );
}

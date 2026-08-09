import { Fragment } from "react";
import { highlightRanges, type SearchHit, type SearchResult } from "../../domain/recall/library";

/** Renders matched terms as <mark> without ever putting user text into HTML. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const ranges = highlightRanges(text, terms);
  if (!ranges.length) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, start)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} className="rounded bg-recall/25 px-0.5 text-ink">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(<Fragment key="tail">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

function Hit({
  hit,
  terms,
  inBin,
  onToggle,
}: {
  hit: SearchHit;
  terms: string[];
  inBin: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="rounded-lg border border-edge bg-surface2 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[11px] text-recall">{hit.segment.t}</span>
          <span className="truncate font-mono text-[10px] tracking-[0.08em] text-faint">
            {hit.source.title}
          </span>
        </span>
        <button
          onClick={onToggle}
          aria-pressed={inBin}
          className={`shrink-0 rounded-lg border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.08em] transition ${
            inBin ? "border-recall bg-recall/15 text-recall" : "border-edge text-muted hover:text-ink"
          }`}
        >
          {inBin ? "IN BIN ✓" : "+ BIN"}
        </button>
      </div>
      <p className="text-sm text-ink">
        <Highlighted text={hit.segment.text} terms={terms} />
      </p>
      {hit.prev && (
        <p className="mt-1.5 border-l-2 border-edge pl-2 text-xs text-faint">
          {hit.prev.text.slice(0, 120)}
        </p>
      )}
    </li>
  );
}

const TRY = ["confidence", "adversity", "reputation", "hero villain", "kids"];

export function SearchResults({
  result,
  query,
  terms,
  hasSources,
  isInBin,
  onToggleClip,
  onTry,
}: {
  result: SearchResult;
  query: string;
  terms: string[];
  hasSources: boolean;
  isInBin: (key: string) => boolean;
  onToggleClip: (srcId: string, idx: number) => void;
  onTry: (t: string) => void;
}) {
  if (!terms.length) {
    return (
      <div className="rounded-lg border border-edge bg-surface2 p-6 text-center">
        <h3 className="mb-1.5 text-base text-ink">Your whole library, one search away.</h3>
        <p className="mx-auto mb-4 max-w-md text-sm text-muted">
          {hasSources
            ? "Type a word or phrase and RECALL surfaces every moment it appears in — across every source you have switched on, timecoded and ready to collect."
            : "Add a transcript first. Paste one in, or upload audio and let the AI transcribe it."}
        </p>
        {hasSources && (
          <div className="flex flex-wrap justify-center gap-2">
            {TRY.map((t) => (
              <button
                key={t}
                onClick={() => onTry(t)}
                className="rounded-lg border border-edge px-2.5 py-1.5 font-mono text-[10px] tracking-[0.08em] text-muted transition hover:text-ink"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!result.hits.length) {
    return (
      <div className="rounded-lg border border-edge bg-surface2 p-6 text-center">
        <h3 className="mb-1.5 text-base text-ink">No moments for “{query}”</h3>
        <p className="text-sm text-muted">
          Try a single distinctive word, or check that the right sources are switched on above.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {result.hits.map((h) => (
        <Hit
          key={h.key}
          hit={h}
          terms={terms}
          inBin={isInBin(h.key)}
          onToggle={() => onToggleClip(h.source.id, h.idx)}
        />
      ))}
    </ul>
  );
}

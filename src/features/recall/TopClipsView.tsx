import { useMemo, useState } from "react";
import { Button, Card } from "../../components/ui";
import { KEYS } from "../../data/keys";
import { useStackKey } from "../../data/hooks";
import { readJSON } from "../../data/storage";
import { EMPTY_HOOKLAB_STATE, type HooklabState } from "../../data/schemas/hooklab";
import {
  buildBank,
  displaySet,
  groundingFor,
  loadWinners,
  scanLibrary,
  type WinnersReason,
} from "../../domain/recall/topclips";
import { persistRun, readScans, relTime, writeScans } from "../../domain/recall/scans";
import type {
  RecallLibrary,
  TopClipCandidate,
  TopClipsState,
} from "../../data/schemas/recall";

/** What to tell the user when there are no ledger winners to match against. */
const NUDGE: Record<WinnersReason, string> = {
  ok: "",
  absent:
    "No HOOKLAB ledger on this device yet. Pattern proof still works; log a winner and your own hooks start outranking it.",
  empty:
    "Your HOOKLAB ledger is empty. Pattern proof still works; log an outcome and your own hooks start outranking it.",
  "no-winners":
    "Nothing in your ledger is marked a winner yet. Mark one and clips echoing it get promoted above generic pattern matches.",
};

const BADGE: Record<string, { label: string; className: string }> = {
  mine: { label: "PROVEN FOR YOU", className: "border-pos text-pos" },
  proof: { label: "PROOF", className: "border-recall text-recall" },
};

function ClipCard({
  c,
  inBin,
  onCollect,
}: {
  c: TopClipCandidate;
  inBin: boolean;
  onCollect: () => void;
}) {
  const badge = c.personalProof ? BADGE.mine : c.label === "proof" ? BADGE.proof : null;
  return (
    <li className="rounded-lg border border-edge bg-surface2 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-recall">{c.t}</span>
          {badge && (
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] ${badge.className}`}
            >
              {badge.label}
            </span>
          )}
          <span className="truncate font-mono text-[10px] tracking-[0.08em] text-faint">
            {c.srcTitle}
          </span>
        </span>
        <button
          onClick={onCollect}
          aria-pressed={inBin}
          className={`shrink-0 rounded-lg border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.08em] transition ${
            inBin ? "border-recall bg-recall/15 text-recall" : "border-edge text-muted hover:text-ink"
          }`}
        >
          {inBin ? "IN BIN ✓" : "+ BIN"}
        </button>
      </div>
      <p className="text-sm text-ink">{c.text}</p>
      <p className="mt-1.5 text-xs text-faint">{groundingFor(c)}</p>
      {(c.noise ?? 0) > 0 && (
        <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-gold">
          TRANSCRIPT LOOKS GARBLED — TRIM BEFORE POSTING
        </p>
      )}
    </li>
  );
}

/**
 * TOP CLIPS: what in the library is actually worth cutting, and why.
 *
 * A scan is saved per source, so reopening the section shows the last result
 * without re-scoring — and a saved scan states when it ran, because a
 * recommendation from before you added three sources is a different claim.
 */
export function TopClipsView({
  library,
  isInBin,
  onCollect,
}: {
  library: RecallLibrary;
  isInBin: (key: string) => boolean;
  onCollect: (srcId: string, idx: number, extra?: Record<string, string>) => void;
}) {
  const [scans, setScans] = useStackKey<TopClipsState>(KEYS.recallTopclips, {});
  const [active, setActive] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const winners = useMemo(() => {
    const state = readJSON<HooklabState>(KEYS.hooklabState, EMPTY_HOOKLAB_STATE);
    return loadWinners(Array.isArray(state?.ledger) ? state.ledger : null);
  }, []);

  const bank = useMemo(() => buildBank(), []);
  const saved = active ? scans[active] : null;
  const shown = useMemo(
    () => (saved ? displaySet(saved.candidates, false) : []),
    [saved],
  );

  const scoutable = library.sources;

  const runScan = (srcId: string, title: string): void => {
    setScanning(true);
    // Yielding once keeps the button's pressed state visible on a big library;
    // the scan itself is synchronous.
    setTimeout(() => {
      const candidates = scanLibrary(library, bank, winners.winners, { onlySrcId: srcId });
      const next = persistRun(readScans(), srcId, title, candidates, {});
      writeScans(next);
      setScans(next);
      setActive(srcId);
      setScanning(false);
    }, 0);
  };

  return (
    <Card
      title="TOP CLIPS"
      hint="What your library already contains that has evidence behind it."
    >
      {winners.reason !== "ok" && (
        <p className="mb-4 rounded-lg border border-edge bg-surface2 p-3 text-sm text-muted">
          {NUDGE[winners.reason]}
        </p>
      )}

      {scoutable.length === 0 ? (
        <p className="text-sm text-muted">Add a source and TOP CLIPS can scan it.</p>
      ) : (
        <ul className="mb-5 space-y-2">
          {scoutable.map((s) => {
            const scan = scans[s.id];
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface2 p-3"
              >
                <span className="min-w-0">
                  <span className="text-sm text-ink">{s.title}</span>
                  <span className="ml-2 font-mono text-[10px] tracking-[0.08em] text-faint">
                    {scan
                      ? `${scan.candidates.length} FOUND · SCANNED ${relTime(scan.savedAt).toUpperCase()}`
                      : "NOT SCANNED"}
                  </span>
                </span>
                <span className="flex gap-2">
                  {scan && (
                    <Button onClick={() => setActive(active === s.id ? null : s.id)}>
                      {active === s.id ? "HIDE" : "VIEW"}
                    </Button>
                  )}
                  <Button
                    onClick={() => runScan(s.id, s.title)}
                    variant={scan ? undefined : "primary"}
                    disabled={scanning}
                  >
                    {scanning ? "SCANNING…" : scan ? "RESCAN" : "SCAN"}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {saved && (
        <>
          <p className="mb-2 font-mono text-[10px] tracking-[0.14em] text-faint">
            SHOWING {shown.length} OF {saved.candidates.length} · SCANNED{" "}
            {relTime(saved.savedAt).toUpperCase()}
          </p>
          {shown.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing in that source scored high enough to recommend. That is an answer, not a
              failure — the moments are still searchable.
            </p>
          ) : (
            <ul className="space-y-2">
              {shown.map((c) => (
                <ClipCard
                  key={c.key}
                  c={c}
                  inBin={isInBin(c.key)}
                  onCollect={() =>
                    onCollect(
                      c.srcId,
                      c.idx,
                      c.match?.kind === "pattern"
                        ? {
                            patternId: c.match.patternId,
                            patternName: c.match.patternName,
                            label: c.personalProof ? "proven-for-you" : "proof",
                          }
                        : undefined,
                    )
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

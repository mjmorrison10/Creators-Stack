import { useState } from "react";
import { Button, Card, StatusLine } from "../../components/ui";
import { copyText } from "../../data/download";
import { buildBinSRT, buildShotList, srtFilename } from "../../domain/recall/library";
import { handoffSummary, queueToBlast } from "../../domain/blast/handoff";
import { loadQueue, saveQueue } from "../../domain/blast/queue";
import type { RecallLibrary } from "../../data/schemas/recall";

/** Text downloads — the JSON path lives in data/download.ts. */
function downloadText(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The clip bin: what a search session actually produced. The SRT export is
 * what makes it useful — Premiere, CapCut and DaVinci all import subtitles, so
 * the bin lands on a timeline instead of being retyped.
 */
export function BinPanel({
  library,
  onRemove,
  onClear,
}: {
  library: RecallLibrary;
  onRemove: (srcId: string, key: string) => void;
  onClear: () => void;
}) {
  const n = library.bin.length;
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  /**
   * Send the bin to BLAST's queue. Clips binned from a TOP CLIPS card carry
   * their hook and pattern; clips binned from plain search carry neither, and
   * there the moment text is both the hook and the caption seed.
   */
  const sendToBlast = (): void => {
    const r = queueToBlast(
      loadQueue(),
      library.bin.map((b) => ({
        key: b.key,
        srcId: b.srcId,
        srcTitle: b.srcTitle,
        t: b.t,
        sec: b.sec,
        text: b.hookText || b.text,
        hookText: b.hookText || b.text,
        ...(b.label ? { label: b.label } : {}),
        ...(b.patternId ? { patternId: b.patternId } : {}),
        ...(b.patternName ? { patternName: b.patternName } : {}),
        ...(b.patternFamily ? { patternFamily: b.patternFamily } : {}),
      })),
      "recall",
    );
    const saved = saveQueue(r.queue);
    setStatus(
      saved.ok
        ? { tone: "ok", text: `${handoffSummary(r)} — open BLAST to write captions.` }
        : { tone: "error", text: "Couldn't queue for BLAST — storage is full." },
    );
  };

  const copyShotList = async (): Promise<void> => {
    const ok = await copyText(buildShotList(library));
    setStatus(
      ok
        ? { tone: "ok", text: "Shot list copied to clipboard." }
        : { tone: "error", text: "Couldn't reach the clipboard. Export the SRT instead." },
    );
  };

  return (
    <Card
      title={`CLIP BIN — ${n}`}
      hint="Collected moments, exportable as subtitles or a shot list."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          disabled={!n}
          onClick={() => downloadText(buildBinSRT(library), srtFilename(), "text/plain")}
        >
          EXPORT SRT
        </Button>
        <Button disabled={!n} onClick={() => void copyShotList()}>
          COPY SHOT LIST
        </Button>
        <Button disabled={!n} onClick={sendToBlast} variant="primary">
          SEND TO BLAST
        </Button>
        {/* Two-step, like removing a source: CLEAR sits next to the export
            buttons and there is no undo — the bin is a whole search session. */}
        {confirming ? (
          <>
            <Button
              onClick={() => {
                setConfirming(false);
                onClear();
              }}
            >
              CLEAR {n} — SURE?
            </Button>
            <Button onClick={() => setConfirming(false)}>KEEP</Button>
          </>
        ) : (
          <Button disabled={!n} onClick={() => setConfirming(true)}>
            CLEAR
          </Button>
        )}
      </div>

      {status && <StatusLine tone={status.tone}>{status.text}</StatusLine>}

      {!n ? (
        <p className="text-sm text-muted">
          Nothing collected yet. Hit + BIN on a moment and it lands here.
        </p>
      ) : (
        <ul className="space-y-2">
          {library.bin.map((b) => (
            <li
              key={b.key}
              className="flex items-start justify-between gap-3 rounded-lg border border-edge bg-surface2 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink">{b.text}</p>
                <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-faint">
                  <span className="text-recall">{b.t}</span> · {b.srcTitle}
                  {b.patternFamily && ` · ${b.patternFamily}`}
                </p>
              </div>
              <Button onClick={() => onRemove(b.srcId, b.key)}>REMOVE</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

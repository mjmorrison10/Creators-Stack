import { useEffect, useRef, useState } from "react";
import { Button, Card, StatusLine } from "../../components/ui";
import { cropTo916, croppedFilename, releaseFFmpeg } from "../../services/ffmpeg";
import { fmtBytes, mediaKindOf } from "../../domain/recall/transcribe";

type Phase = "idle" | "loading" | "working" | "done";

/**
 * Centre-crop a landscape clip to 9:16, entirely on-device.
 *
 * The engine is ffmpeg compiled to wasm and it is ~31MB, so nothing here is
 * fetched until REFORMAT is pressed — the panel itself costs nothing to mount.
 * The whole transcode runs in the tab: the video never leaves the machine,
 * which is the point for footage that isn't published yet.
 */
export function CropPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [ratio, setRatio] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);

  // Object URLs and the wasm core both leak if the panel just disappears.
  const resultRef = useRef<string | null>(null);
  resultRef.current = result?.url ?? null;
  useEffect(() => {
    return () => {
      if (resultRef.current) URL.revokeObjectURL(resultRef.current);
      releaseFFmpeg();
    };
  }, []);

  const pick = (f: File | null): void => {
    if (!f) return;
    // RECALL's media gate, narrowed: transcription takes audio, cropping does
    // not. A .srt or an .mp3 gets told no here rather than being handed to a
    // demuxer that fails cryptically a minute into the load.
    if (mediaKindOf(f) !== "video") {
      setError("That file isn't video — the crop tool takes video files only.");
      return;
    }
    setError(null);
    setFile(f);
    setPhase("idle");
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  };

  const run = async (): Promise<void> => {
    if (!file) return;
    setError(null);
    setRatio(0);
    setPhase("loading");
    try {
      const bytes = await cropTo916(file, (r) => {
        setPhase("working");
        setRatio(r);
      });
      const url = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: "video/mp4" }),
      );
      if (result) URL.revokeObjectURL(result.url);
      setResult({ url, name: croppedFilename(file.name) });
      setPhase("done");
    } catch (err) {
      setPhase("idle");
      setError(
        `Reformat failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  };

  const busy = phase === "loading" || phase === "working";
  const pct = Math.min(100, Math.round(ratio * 100));

  return (
    <Card
      title="9:16 CROP"
      hint="Centre-crops landscape footage to vertical, on this device. Nothing is uploaded."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-edge px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] text-muted transition hover:text-ink">
          CHOOSE VIDEO
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </label>
        {file && (
          <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
            {file.name} · {fmtBytes(file.size)}
          </span>
        )}
      </div>

      {error && <StatusLine tone="error">{error}</StatusLine>}

      <Button disabled={!file || busy} onClick={() => void run()} variant="primary">
        {phase === "loading"
          ? "LOADING ENGINE…"
          : phase === "working"
            ? "REFORMATTING…"
            : phase === "done"
              ? "REFORMAT AGAIN"
              : "REFORMAT TO 9:16"}
      </Button>

      {busy && (
        <div className="mt-4">
          <div
            role="progressbar"
            aria-label="Reformat progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-surface2"
          >
            <div
              className="h-full bg-blast transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-faint">
            {phase === "loading" ? "Fetching the engine — this happens once." : `${pct}%`}
          </p>
        </div>
      )}

      {result && (
        <div className="mt-4">
          <video
            src={result.url}
            controls
            className="max-h-80 rounded-lg border border-edge bg-ground"
          />
          <div className="mt-3">
            <a
              href={result.url}
              download={result.name}
              className="inline-block rounded-lg border border-edge px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] text-muted transition hover:text-ink"
            >
              DOWNLOAD {result.name}
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}

import { useState } from "react";
import { Button } from "../../components/ui";
import { copyText } from "../../data/download";
import { checkCaption, STATUS_LABEL, type Platform, type PostStatus } from "../../domain/blast/platforms";
import { applyTemplate, navTarget } from "../../domain/blast/compose";
import type { BlastPost } from "../../domain/blast/queue";

const STATUS_TONE: Record<PostStatus, string> = {
  none: "border-edge text-faint",
  copied: "border-edge text-muted",
  opened: "border-blast text-blast",
  posted: "border-pos text-pos",
  skipped: "border-edge text-faint",
};

/**
 * One platform's caption, counter and posting state.
 *
 * The character count is a warning, never a block: the platforms move these
 * numbers and a stale cap should not be what stops someone posting.
 */
export function PlatformCard({
  platform,
  post,
  preset,
  onCaption,
  onStatus,
  onPosted,
}: {
  platform: Platform;
  post: BlastPost;
  preset: string | undefined;
  onCaption: (text: string) => void;
  onStatus: (next: PostStatus) => void;
  onPosted: (url: string, caption: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [url, setUrl] = useState("");

  const base = post.captions[platform.name] ?? post.text ?? "";
  const outgoing = preset ? applyTemplate(preset, base) : base;
  const check = checkCaption(platform.name, outgoing);
  const status = post.status[platform.name] ?? "none";

  const copy = async (open: boolean): Promise<void> => {
    // The clipboard copy always happens first, so it is the backup whatever
    // the platform does with the URL.
    const ok = await copyText(outgoing);
    setCopied(ok ? "Copied." : "Couldn't reach the clipboard — select the caption and copy it.");
    if (!ok) return;
    onStatus("copied");
    if (!open) return;

    const target = navTarget(platform, outgoing);
    if (!target.url) return;
    if (target.mode === "scheme") window.location.href = target.url;
    else window.open(target.url, "_blank", "noopener");
    onStatus("opened");
  };

  return (
    <li className="rounded-lg border border-edge bg-surface2 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span aria-hidden>{platform.icon}</span>
          <span className="text-sm text-ink">{platform.name}</span>
          {platform.note && (
            <span className="font-mono text-[9px] tracking-[0.08em] text-faint">
              {platform.note.toUpperCase()}
            </span>
          )}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] ${STATUS_TONE[status]}`}
        >
          {STATUS_LABEL[status].toUpperCase()}
        </span>
      </div>

      <label className="sr-only" htmlFor={`cap-${platform.name}`}>
        {platform.name} caption
      </label>
      <textarea
        id={`cap-${platform.name}`}
        value={base}
        onChange={(e) => onCaption(e.target.value)}
        rows={3}
        placeholder="Falls back to the base caption if left blank."
        className="w-full rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink"
      />

      <p className="mt-1 flex flex-wrap gap-3 font-mono text-[10px] tracking-[0.08em]">
        <span className={check.tooLong ? "text-gold" : "text-faint"}>
          {check.length}/{check.limit}
          {check.tooLong && ` · ${check.over} OVER`}
        </span>
        <span className={check.tooManyHashtags ? "text-gold" : "text-faint"}>
          {check.hashtags} HASHTAG{check.hashtags === 1 ? "" : "S"}
          {check.tooManyHashtags && ` · ${check.hashtagMax} RECOMMENDED`}
        </span>
        {preset && <span className="text-blast">PRESET APPLIED</span>}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button onClick={() => void copy(false)}>COPY</Button>
        <Button onClick={() => void copy(true)} variant="primary">
          COPY + OPEN
        </Button>
        {status !== "posted" && status !== "skipped" && (
          <>
            <Button onClick={() => setMarking(!marking)}>MARK POSTED</Button>
            <Button onClick={() => onStatus("skipped")}>SKIP</Button>
          </>
        )}
      </div>

      {marking && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`url-${platform.name}`}>
            {platform.name} post URL
          </label>
          <input
            id={`url-${platform.name}`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste the post URL (optional — PULSE tracks it)"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-ground px-3 py-1.5 text-sm text-ink"
          />
          <Button
            onClick={() => {
              // The caption is recorded as it actually went out, preset and
              // all — PULSE reports on what was posted, not what was typed.
              onPosted(url.trim(), outgoing);
              setMarking(false);
              setUrl("");
            }}
            variant="primary"
          >
            CONFIRM
          </Button>
        </div>
      )}

      {copied && <p className="mt-2 text-xs text-muted">{copied}</p>}
    </li>
  );
}

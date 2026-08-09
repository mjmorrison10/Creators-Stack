import { useState } from "react";
import { Button } from "../../components/ui";
import { CHECKPOINTS, type PulsePost } from "../../data/schemas/pulse";
import {
  ckLabel,
  fmtNum,
  inHours,
  latestSnap,
  maxCovered,
  nextDue,
  relTime,
  stepFor,
  velocityPerHr,
} from "../../domain/pulse/snapshots";
import { ytId } from "../../services/youtube";
import { Sparkline } from "./Sparkline";

/**
 * The views input, with ± steppers.
 *
 * Prefilled with the last recorded number as RAW DIGITS — never `fmtNum` —
 * because it is an editable value, and "12K" is not something you can add 300
 * to. The steppers move ~1% of scale so they are useful at 300 views and at
 * 300k alike.
 */
export function ViewsInput({
  post,
  placeholder = "views",
  onRecord,
  onAdvance,
}: {
  post: PulsePost;
  placeholder?: string;
  onRecord: (views: number) => void;
  onAdvance?: () => void;
}) {
  const last = latestSnap(post);
  const base = last ? String(last.views) : "";
  const [value, setValue] = useState(base);
  const [edited, setEdited] = useState(false);
  const [seenBase, setSeenBase] = useState(base);

  // Follow a reading that arrived from somewhere else — an auto check, a
  // cross-tab write — unless the creator is mid-edit.
  //
  // Without this the box keeps the OLD number while the card shows the new one,
  // looking like unsubmitted input. Pressing RECORD (or Enter, walking down the
  // list) then writes the stale figure as a fresh manual reading, which becomes
  // `latestSnap` — and if that post was auto-promoted, the very next
  // `syncAutoWinners` drops it below the cutoff, retracts its ledger row and
  // tombstones it, so a sync can't restore it either.
  if (base !== seenBase) {
    setSeenBase(base);
    if (!edited) setValue(base);
  }

  const step = (dir: number): void => {
    const cur = value.trim() === "" || Number.isNaN(Number(value)) ? Number(base) || 0 : Number(value);
    setValue(String(Math.max(0, cur + dir * stepFor(cur))));
    setEdited(true);
  };

  const submit = (advance: boolean): void => {
    const v = value.trim();
    if (v === "" || Number.isNaN(Number(v))) return;
    onRecord(Number(v));
    // The submitted value becomes the new base, so the box is no longer "edited"
    // and will follow the next reading that arrives.
    setEdited(false);
    if (advance) onAdvance?.();
  };

  // Highlight only what the CREATOR changed — a value that merely trails a
  // freshly fetched reading is not unsubmitted input.
  const changed = edited && value !== base;

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`decrease views for ${post.platform}`}
        onClick={() => step(-1)}
        className="rounded border border-edge px-2 py-1 text-sm text-muted transition hover:text-ink"
      >
        −
      </button>
      <label className="sr-only" htmlFor={`snap-${post.id}`}>
        {post.platform} views
      </label>
      <input
        id={`snap-${post.id}`}
        data-snap-input
        type="number"
        min={0}
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setEdited(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit(true);
          }
        }}
        className={`w-28 rounded-lg border bg-ground px-2 py-1 text-sm text-ink ${
          changed ? "border-pulse" : "border-edge"
        }`}
      />
      <button
        type="button"
        aria-label={`increase views for ${post.platform}`}
        onClick={() => step(1)}
        className="rounded border border-edge px-2 py-1 text-sm text-muted transition hover:text-ink"
      >
        +
      </button>
      <Button onClick={() => submit(false)}>RECORD</Button>
    </span>
  );
}

/**
 * The checkpoint strip: which readings are in, which are owed, which are still
 * ahead. Only the FIRST pending chip is emphasized — the rest are the schedule,
 * not a to-do list.
 */
function Checks({ post, now }: { post: PulsePost; now: number }) {
  const covered = maxCovered(post);
  let seenPending = false;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {CHECKPOINTS.map((h) => {
        const due = now >= post.postedAt + h * 3600000;
        const done = h * 60 <= covered;
        const first = !done && !due && !seenPending;
        if (!done && !due) seenPending = true;
        const tone = done
          ? "border-pos text-pos"
          : due
            ? "border-gold text-gold"
            : first
              ? "border-edge text-muted"
              : "border-edge text-faint";
        return (
          <li key={h}>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] ${tone}`}
            >
              {done
                ? `${ckLabel(h)} ✓`
                : due
                  ? `${ckLabel(h)} DUE`
                  : `${ckLabel(h)} ${inHours(post.postedAt + h * 3600000, now)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The numbers, or an honest "no reading yet". */
function Metrics({ post, now }: { post: PulsePost; now: number }) {
  const last = latestSnap(post);
  if (!last) {
    return <p className="mt-2 font-mono text-[10px] tracking-[0.08em] text-faint">NO READING YET</p>;
  }
  const vel = velocityPerHr(post);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4">
      <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
        <span className="text-base text-ink">{fmtNum(last.views)}</span> VIEWS ·{" "}
        {relTime(last.at, now).toUpperCase()}
      </span>
      {last.likes != null && (
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
          <span className="text-ink">{fmtNum(last.likes)}</span> LIKES
        </span>
      )}
      {last.comments != null && (
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
          <span className="text-ink">{fmtNum(last.comments)}</span> COMMENTS
        </span>
      )}
      {vel != null && (
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
          <span className="text-ink">{fmtNum(vel)}</span> VIEWS/HR
        </span>
      )}
      <Sparkline post={post} />
    </div>
  );
}

const OUTCOMES = [
  { id: "winner", label: "Winner" },
  { id: "meh", label: "Meh" },
  { id: "dead", label: "Dead" },
] as const;

/**
 * One tracked post, in the by-clip view.
 *
 * This is the only place a post can be judged, deleted or read in full — the
 * by-platform view is deliberately thinner, so the walk-down list stays
 * walkable.
 */
export function PostCard({
  post,
  now,
  promoted,
  hasKey,
  onRecord,
  onAdvance,
  onCheck,
  onSetLink,
  onOutcome,
  onStopTracking,
  onDelete,
}: {
  post: PulsePost;
  now: number;
  promoted: boolean;
  hasKey: boolean;
  onRecord: (views: number) => void;
  onAdvance: () => void;
  onCheck: () => void;
  onSetLink: (url: string) => void;
  onOutcome: (o: "winner" | "meh" | "dead") => void;
  onStopTracking: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState<"stop" | "delete" | null>(null);
  const due = nextDue(post, now);
  const isYt = /youtu\.?be|youtube\.com/i.test(post.url) || post.platform === "YouTube Shorts";
  const canAutoCheck = isYt && !!ytId(post.url) && hasKey;
  const caption = post.caption.replace(/\s+/g, " ").trim();

  return (
    <li className={`rounded-lg border p-3 ${due != null ? "border-gold/40" : "border-edge"} bg-surface2`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.08em] text-pulse">
          {post.platform.toUpperCase()}
        </span>
        <span className="font-mono text-[9px] tracking-[0.08em] text-faint">
          {isYt && ytId(post.url) ? "YOUTUBE AUTO" : "MANUAL"}
        </span>
      </div>

      <p className="mt-1 text-sm text-ink">{post.hook || <span className="text-faint">(no hook noted)</span>}</p>
      {caption && caption !== post.hook.trim() && (
        <p className="mt-0.5 text-xs text-muted">{caption}</p>
      )}

      <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-[0.08em] text-faint">
        {post.url ? (
          <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-pulse underline">
            OPEN POST ↗
          </a>
        ) : (
          <button
            onClick={() => {
              const v = window.prompt(`Paste the live post link for ${post.platform}`, post.url || "");
              if (v === null) return;
              const t = v.trim();
              if (t && !/^https?:\/\//i.test(t)) {
                window.alert("That doesn't look like a link (needs http…)");
                return;
              }
              onSetLink(t);
            }}
            className="text-muted underline transition hover:text-ink"
          >
            ＋ ADD LINK
          </button>
        )}
        <span>POSTED {relTime(post.postedAt, now).toUpperCase()}</span>
      </p>

      <Checks post={post} now={now} />
      <Metrics post={post} now={now} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canAutoCheck && <Button onClick={onCheck}>CHECK NOW</Button>}
        <ViewsInput post={post} placeholder="e.g. 12400" onRecord={onRecord} onAdvance={onAdvance} />
        {due != null && (
          <span className="font-mono text-[10px] tracking-[0.08em] text-gold">
            {ckLabel(due)} CHECK IS DUE
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">HOW DID IT DO?</span>
        {OUTCOMES.map((o) => (
          <button
            key={o.id}
            onClick={() => onOutcome(o.id)}
            aria-pressed={post.outcome === o.id}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              post.outcome === o.id
                ? "border-pulse bg-surface text-ink"
                : "border-edge text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
        {promoted && (
          <span
            className="font-mono text-[9px] tracking-[0.08em] text-gold"
            title="This hook cleared every auto-promotion gate against your own numbers on this platform."
          >
            ✦ AUTO IN HOOKLAB
          </span>
        )}
        {post.ledgerLoggedAt && (
          <span className="font-mono text-[9px] tracking-[0.08em] text-pos">✓ IN HOOKLAB LEDGER</span>
        )}
      </div>

      {/* Two-step, and the two deletes are genuinely different: one keeps the
          ledger evidence, the other removes it. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {confirming === null ? (
          <>
            <Button onClick={() => setConfirming("stop")}>STOP TRACKING</Button>
            <Button onClick={() => setConfirming("delete")}>DELETE</Button>
          </>
        ) : confirming === "stop" ? (
          <>
            <Button
              onClick={() => {
                setConfirming(null);
                onStopTracking();
              }}
            >
              STOP TRACKING — KEEPS THE LEDGER ENTRY
            </Button>
            <Button onClick={() => setConfirming(null)}>CANCEL</Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                setConfirming(null);
                onDelete();
              }}
            >
              DELETE{post.ledgerLoggedAt ? " — REMOVES THE LEDGER ENTRY TOO" : " — SURE?"}
            </Button>
            <Button onClick={() => setConfirming(null)}>CANCEL</Button>
          </>
        )}
      </div>
    </li>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { SectionHeader } from "../../components/SectionHeader";
import { Button, Card, StatusLine } from "../../components/ui";
import { SECTIONS } from "../../sections";
import type { PulsePost } from "../../data/schemas/pulse";
import {
  buildClipGroups,
  buildPlatformGroups,
  clipSummary,
  pickPlatform,
} from "../../domain/pulse/grouping";
import { fmtNum, latestSnap, nextDue, relTime, ckLabel } from "../../domain/pulse/snapshots";
import { ytId } from "../../services/youtube";
import { PostCard, ViewsInput } from "./PostCard";
import { AddPostForm } from "./AddPostForm";
import { usePulse, useExpanded, usePlatformPick } from "./usePulse";
import { useYouTube } from "./useYouTube";

const meta = SECTIONS[3]!;

/** A status line with a way to get rid of it. */
function Dismissible({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-0 flex-1">{children}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss this message"
        className="mt-1 text-faint transition hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}

/** Move focus to the next VISIBLE views input — collapsed cards are skipped. */
function advanceFromCurrent(): void {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input[data-snap-input]")];
  const at = inputs.indexOf(document.activeElement as HTMLInputElement);
  for (let i = at + 1; i < inputs.length; i++) {
    if (inputs[i]!.offsetParent !== null) {
      inputs[i]!.focus();
      return;
    }
  }
}

export function PulseSection() {
  const pulse = usePulse();
  const expanded = useExpanded();
  const platformPick = usePlatformPick();
  const yt = useYouTube(pulse);
  const [showAdd, setShowAdd] = useState(false);

  // Legacy checks what is due as soon as the section opens with a key present
  // (app.js:1357). Without it a batch imported and left alone is never fetched,
  // and the 1h/2h/6h checkpoints are gone for good — a reading at 168h covers
  // them without backfilling, so the early-velocity signal is unrecoverable.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (pulse.settingsRef.current.ytKey) void yt.checkDue(false);
    // Once, at mount, after the healers have settled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One clock per render, so every card agrees on what "due" means.
  const now = Date.now();
  const view = pulse.settings.view;

  const clipGroups = useMemo(
    () => buildClipGroups(pulse.posts, now),
    // `now` intentionally excluded: it changes every render and the grouping
    // only needs to be recomputed when the posts do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pulse.posts],
  );
  const platformGroups = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => buildPlatformGroups(pulse.posts, now),
    [pulse.posts],
  );
  const selected = pickPlatform(platformGroups, platformPick.platform);
  const shown = platformGroups.find((g) => g.platform === selected);

  const hasKey = !!pulse.settings.ytKey;
  const dueTotal = pulse.posts.filter((p) => nextDue(p, now) != null).length;

  const cardFor = (p: PulsePost) => (
    <PostCard
      key={p.id}
      post={p}
      now={now}
      promoted={!!pulse.promoted[p.id]}
      hasKey={hasKey}
      onRecord={(v) => pulse.record(p.id, { views: v }, "manual")}
      onAdvance={advanceFromCurrent}
      onCheck={() => void yt.checkOne(p, true)}
      onSetLink={(url) => {
        pulse.update(p.id, (x) => ({ ...x, url }));
        // A pasted link is the missing piece for auto-tracking, so use it
        // straight away rather than waiting for the next section open.
        if (url && ytId(url) && hasKey) void yt.checkOne({ ...p, url }, false);
      }}
      onOutcome={(o) => pulse.setOutcome(p.id, o)}
      onStopTracking={() => pulse.stopTracking(p.id)}
      onDelete={() => pulse.deleteEverywhere(p.id)}
    />
  );

  return (
    <>
      <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />

      {/* Legacy toasts faded after a few seconds; these persist until replaced,
          so each one carries a way to dismiss it rather than stacking three
          stale banners above the list. */}
      {pulse.notice && (
        <Dismissible onDismiss={pulse.clearNotice}>
          <StatusLine tone={pulse.notice.tone}>{pulse.notice.text}</StatusLine>
        </Dismissible>
      )}
      {pulse.autoNotice && (
        <Dismissible onDismiss={pulse.clearAutoNotice}>
          <StatusLine tone="ok">{pulse.autoNotice}</StatusLine>
        </Dismissible>
      )}
      {yt.status && (
        <Dismissible onDismiss={yt.clearStatus}>
          <StatusLine tone={yt.status.tone}>{yt.status.text}</StatusLine>
        </Dismissible>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            pulse.importBlast();
            // Legacy checks after an import that added posts (app.js:818) —
            // the point of importing is to start measuring.
            void yt.checkDue(false);
          }}
          variant="primary"
        >
          IMPORT FROM BLAST
        </Button>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? "HIDE ADD" : "ADD MANUALLY"}</Button>
        <Button disabled={!hasKey || yt.busy} onClick={() => void yt.checkDue(true)}>
          {yt.busy ? "CHECKING…" : "CHECK YOUTUBE"}
        </Button>
        <span className="ml-auto flex gap-1">
          {(["clips", "platforms"] as const).map((v) => (
            <button
              key={v}
              onClick={() => pulse.saveSettings({ ...pulse.settings, view: v })}
              aria-pressed={view === v}
              className={`rounded-lg border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.08em] transition ${
                view === v ? "border-pulse bg-surface2 text-pulse" : "border-edge text-muted"
              }`}
            >
              BY {v.toUpperCase()}
            </button>
          ))}
        </span>
      </div>

      {dueTotal > 0 && (
        <p className="mb-4 font-mono text-[10px] tracking-[0.08em] text-gold">
          {dueTotal} CHECK-IN{dueTotal === 1 ? "" : "S"} DUE
        </p>
      )}

      {showAdd && (
        <AddPostForm
          posts={pulse.posts}
          settings={pulse.settings}
          onSaveSettings={pulse.saveSettings}
          onAdd={(created) => {
            pulse.addPosts(created);
            setShowAdd(false);
            void yt.checkDue(false);
          }}
        />
      )}

      {pulse.posts.length === 0 ? (
        <Card title="NOTHING TRACKED YET" hint="PULSE is where a posted clip turns into evidence.">
          <p className="text-sm text-muted">
            Mark clips posted in BLAST and hit IMPORT FROM BLAST, or add one by hand. Once a post
            has readings, its hook can earn its way into your HOOKLAB ledger.
          </p>
        </Card>
      ) : view === "clips" ? (
        <ul className="space-y-3">
          {clipGroups.map((g) => {
            const open = !!expanded.keys[g.key];
            return (
              <li
                key={g.key}
                className={`rounded-xl border ${g.anyDue ? "border-gold/40" : "border-edge"} bg-surface`}
              >
                <button
                  onClick={() => expanded.toggle(g.key)}
                  aria-expanded={open}
                  className="flex w-full items-start gap-2 p-3 text-left"
                >
                  <span aria-hidden className="mt-0.5 text-faint">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">
                      {g.hook || <span className="text-faint">(no hook noted)</span>}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] tracking-[0.08em] text-faint">
                      {clipSummary(g).toUpperCase()}
                    </span>
                  </span>
                </button>
                {open && <ul className="space-y-2 px-3 pb-3">{g.posts.map(cardFor)}</ul>}
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <ul className="mb-4 flex flex-wrap gap-2">
            {platformGroups.map((g) => (
              <li key={g.platform}>
                <button
                  onClick={() => platformPick.pick(g.platform)}
                  aria-pressed={g.platform === selected}
                  className={`rounded-lg border px-2.5 py-1.5 text-sm transition ${
                    g.platform === selected
                      ? "border-pulse bg-surface2 text-ink"
                      : "border-edge text-muted hover:text-ink"
                  }`}
                >
                  {g.platform}
                  <span className="ml-1.5 font-mono text-[10px] text-faint">{g.posts.length}</span>
                  {g.dueCount > 0 && (
                    <span className="ml-1.5 font-mono text-[10px] text-gold">
                      {g.dueCount} due
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* Deliberately thin rows: no outcome buttons, no delete, no
              checkpoint strip. This is the walk-down list — one number per
              row, Enter moves to the next. Judging happens in the clip view. */}
          <ul className="space-y-2">
            {(shown?.posts ?? []).map((p) => {
              const last = latestSnap(p);
              const due = nextDue(p, now);
              return (
                <li
                  key={p.id}
                  className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${
                    due != null ? "border-gold/40" : "border-edge"
                  } bg-surface2`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink" title={p.caption || p.hook}>
                      {p.hook || <span className="text-faint">(no hook)</span>}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] tracking-[0.08em] text-faint">
                      {relTime(p.postedAt, now).toUpperCase()} ·{" "}
                      {last ? `${fmtNum(last.views)} VIEWS` : "NO READING"}
                      {due != null ? ` · ${ckLabel(due)} DUE` : last ? " · ✓" : ""}
                    </span>
                  </span>
                  {p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open the ${p.platform} post`}
                      className="text-pulse"
                    >
                      ↗
                    </a>
                  ) : (
                    <button
                      onClick={() => {
                        const v = window.prompt(
                          `Paste the live post link for ${p.platform}`,
                          p.url || "",
                        );
                        if (v === null) return;
                        const t = v.trim();
                        if (t && !/^https?:\/\//i.test(t)) {
                          window.alert("That doesn't look like a link (needs http…)");
                          return;
                        }
                        pulse.update(p.id, (x) => ({ ...x, url: t }));
                        if (t && ytId(t) && hasKey) void yt.checkOne({ ...p, url: t }, false);
                      }}
                      aria-label={`Add the ${p.platform} link`}
                      className="text-muted transition hover:text-ink"
                    >
                      ＋
                    </button>
                  )}
                  <ViewsInput
                    post={p}
                    onRecord={(v) => pulse.record(p.id, { views: v }, "manual")}
                    onAdvance={advanceFromCurrent}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

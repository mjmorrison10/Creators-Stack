/**
 * How the two views group and order posts. Ported from pulse/app.js
 * (`clipGroupKey` ~869, `buildClipGroups` ~880, `buildPlatformGroups` ~957).
 *
 * Render-layer only — none of these keys are stored. `clipId` is the stored
 * identity; these are what the UI falls back to when a post predates it or was
 * added by hand.
 */

import type { PulsePost } from "../../data/schemas/pulse";
import { latestSnap, nextDue, PLATFORMS } from "./snapshots";

/**
 * Group identity, strongest first: the stored clip id, then the clip key, then
 * the hook text, then the post's own id so a lone post is still its own group
 * rather than fusing with every other hookless one.
 */
export function clipGroupKey(post: PulsePost): string {
  if (post.clipId) return "g:" + post.clipId;
  const ck = String(post.clipKey || "").trim();
  if (ck) return "c:" + ck.toLowerCase();
  const hook = String(post.hook || "").trim();
  if (hook) return "h:" + hook.toLowerCase();
  return "i:" + post.id;
}

export interface ClipGroup {
  key: string;
  /** The clipKey or hook of the FIRST post encountered in this group. */
  hook: string;
  posts: PulsePost[];
  dueCount: number;
  anyDue: boolean;
  maxPostedAt: number;
  best: { views: number; platform: string } | null;
}

function platformOrder(name: string): number {
  const i = (PLATFORMS as readonly string[]).indexOf(name);
  return i === -1 ? 99 : i;
}

/**
 * The by-clip view.
 *
 * Groups sort due-first, then newest — a check-in you owe outranks a clip that
 * is merely recent, because the whole point of the section is not missing the
 * window.
 */
export function buildClipGroups(posts: PulsePost[], now: number): ClipGroup[] {
  const byKey = new Map<string, ClipGroup>();
  const order: string[] = [];

  for (const p of posts) {
    const key = clipGroupKey(p);
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        hook: String(p.clipKey || p.hook || ""),
        posts: [],
        dueCount: 0,
        anyDue: false,
        maxPostedAt: 0,
        best: null,
      };
      byKey.set(key, g);
      order.push(key);
    }
    g.posts.push(p);
    if (nextDue(p, now) != null) {
      g.dueCount++;
      g.anyDue = true;
    }
    if (p.postedAt > g.maxPostedAt) g.maxPostedAt = p.postedAt;
    const last = latestSnap(p);
    // Strict `>` so the first post to reach the max keeps the credit.
    if (last && (!g.best || last.views > g.best.views)) {
      g.best = { views: last.views, platform: p.platform };
    }
  }

  const groups = order.map((k) => byKey.get(k)!);
  for (const g of groups) {
    g.posts.sort(
      (a, b) => platformOrder(a.platform) - platformOrder(b.platform) || a.postedAt - b.postedAt,
    );
  }
  return groups.sort(
    (a, b) => Number(b.anyDue) - Number(a.anyDue) || b.maxPostedAt - a.maxPostedAt,
  );
}

/** The one-line summary under a clip's hook. */
export function clipSummary(g: ClipGroup): string {
  const n = g.posts.length;
  return [
    `${n} platform${n === 1 ? "" : "s"}`,
    g.dueCount ? `${g.dueCount} due now` : "none due",
    g.best ? `best ${g.best.views.toLocaleString()} on ${g.best.platform}` : "no views yet",
  ].join(" · ");
}

export interface PlatformGroup {
  platform: string;
  posts: PulsePost[];
  dueCount: number;
}

/**
 * The by-platform view: newest first within each platform, because this is the
 * walk-down list — you work through what you posted most recently.
 */
export function buildPlatformGroups(posts: PulsePost[], now: number): PlatformGroup[] {
  const byName = new Map<string, PulsePost[]>();
  for (const p of posts) {
    const list = byName.get(p.platform);
    if (list) list.push(p);
    else byName.set(p.platform, [p]);
  }

  return [...byName.keys()]
    .sort((a, b) => platformOrder(a) - platformOrder(b) || a.localeCompare(b))
    .map((platform) => {
      const list = byName.get(platform)!.slice().sort((a, b) => b.postedAt - a.postedAt);
      return {
        platform,
        posts: list,
        dueCount: list.filter((p) => nextDue(p, now) != null).length,
      };
    });
}

/**
 * Which platform the by-platform view should show.
 *
 * Keeps the creator's pick when it still has posts; otherwise falls to the
 * first platform with something owed, then the first with anything at all —
 * so the view opens on work rather than on an empty column.
 */
export function pickPlatform(groups: PlatformGroup[], current: string): string {
  if (current && groups.some((g) => g.platform === current)) return current;
  return groups.find((g) => g.dueCount > 0)?.platform ?? groups[0]?.platform ?? "";
}

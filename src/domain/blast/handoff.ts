/**
 * RECALL → BLAST. Ported from recall/app.js `queueToBlast`.
 *
 * Re-sending a bin you've grown by three must not duplicate the other twenty,
 * so clips already queued are skipped by key. But a re-send DOES fill in
 * metadata the queued twin is missing — a clip queued before its hook or its
 * pattern was known gets healed by sending it again, rather than the creator
 * having to delete and re-add it.
 */

import { blankPost, type BlastPost, type BlastQueue } from "./queue";

/** Fields a re-send may fill in on an existing clip, never overwrite. */
export const HANDOFF_META = [
  "hookText",
  "label",
  "patternId",
  "patternName",
  "patternFamily",
] as const;

export interface HandoffClip {
  key: string;
  srcId?: string;
  srcTitle?: string;
  t?: string;
  sec?: number;
  text?: string;
  hookText?: string;
  label?: string;
  patternId?: string;
  patternName?: string;
  patternFamily?: string;
}

export interface HandoffResult {
  queue: BlastQueue;
  added: number;
  skipped: number;
  /** Already queued, but gained metadata they were missing. */
  healed: number;
}

export function queueToBlast(
  q: BlastQueue,
  clips: HandoffClip[],
  source = "recall",
  now = Date.now(),
): HandoffResult {
  const byKey = new Map(q.clips.map((c) => [c.key, c]));
  const out = [...q.clips];
  let added = 0;
  let skipped = 0;
  let healed = 0;

  for (const c of clips) {
    if (!c?.key) continue;

    const twin = byKey.get(c.key);
    if (twin) {
      // Fill gaps only. Overwriting would undo edits the creator made in BLAST.
      const patch: Partial<BlastPost> = {};
      let filled = 0;
      for (const f of HANDOFF_META) {
        if (c[f] && !twin[f]) {
          (patch as Record<string, string>)[f] = c[f]!;
          filled++;
        }
      }
      if (filled) {
        const updated = { ...twin, ...patch, updatedAt: now };
        byKey.set(c.key, updated);
        out[out.indexOf(twin)] = updated;
        healed++;
      } else {
        skipped++;
      }
      continue;
    }

    const np = blankPost(
      c.key,
      {
        srcId: c.srcId || "",
        srcTitle: c.srcTitle || "",
        t: c.t || "",
        sec: c.sec || 0,
        text: String(c.text || "").trim(),
        hookText: String(c.hookText || "").trim(),
        label: c.label || "",
        patternId: c.patternId || "",
        patternName: c.patternName || "",
        patternFamily: c.patternFamily || "",
        source,
      },
      now,
    );
    byKey.set(c.key, np);
    out.push(np);
    added++;
  }

  return { queue: { ...q, clips: out, updatedAt: now }, added, skipped, healed };
}

/** A human summary of what a handoff actually did. */
export function handoffSummary(r: HandoffResult): string {
  const tail: string[] = [];
  if (r.healed) tail.push(`${r.healed} updated`);
  if (r.skipped) tail.push(`${r.skipped} already queued`);
  return (
    `Queued ${r.added} clip${r.added === 1 ? "" : "s"} for BLAST` +
    (tail.length ? ` (${tail.join(", ")})` : "")
  );
}

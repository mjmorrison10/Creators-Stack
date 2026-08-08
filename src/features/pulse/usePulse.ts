import { useCallback, useEffect, useRef, useState } from "react";
import { KEYS, SESSION_KEYS } from "../../data/keys";
import {
  readJSON,
  readSessionJSON,
  subscribe,
  writeJSON,
  writeSessionJSON,
} from "../../data/storage";
import { tombstone } from "../../data/stackdata/tombstones";
import type { PulsePost, PulseSettings } from "../../data/schemas/pulse";
import { healImportTwins, migrateClipIds } from "../../domain/pulse/healers";
import {
  announceAuto,
  deleteLedgerEntry,
  logToLedger,
  syncAutoWinners,
  type Outcome,
} from "../../domain/pulse/ledger";
import { recordSnapshot, type ReadingInput } from "../../domain/pulse/snapshots";
import {
  importBackupPosts,
  importFromBlast,
  importSummary,
  type ClipRecord,
} from "../../domain/pulse/import";
import { loadQueue } from "../../domain/blast/queue";

const SAVE_FAILED = "Couldn't save — storage is full or blocked.";

const DEFAULT_SETTINGS: PulseSettings = { ytKey: "", view: "clips", platforms: null };

export interface Notice {
  tone: "ok" | "error";
  text: string;
}

/**
 * PULSE's posts, and the one path every write takes.
 *
 * Every mutation funnels through `commit`: persist, then recompute the
 * auto-promoted set, then surface whatever changed. That single sink is what
 * makes the promotion engine impossible to bypass — the legacy achieved it by
 * putting `syncAutoWinners` inside `savePosts`, and the same discipline applies
 * here for the same reason.
 *
 * State updaters stay pure and reads go through a ref, so two writes in the
 * same tick still see each other without a side effect happening during render
 * (the defect a Phase 5 review found in the BLAST equivalent).
 */
export function usePulse() {
  const [posts, setPosts] = useState<PulsePost[]>(() =>
    readJSON<PulsePost[]>(KEYS.pulsePosts, []),
  );
  const [settings, setSettings] = useState<PulseSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...readJSON<Partial<PulseSettings>>(KEYS.pulseSettings, {}),
  }));
  const [promoted, setPromoted] = useState<Record<string, true>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [autoNotice, setAutoNotice] = useState<string | null>(null);

  const postsRef = useRef(posts);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const adopt = useCallback((next: PulsePost[]) => {
    postsRef.current = next;
    setPosts(next);
  }, []);

  /**
   * Persist, then recompute the auto set. Returns whether the write landed.
   *
   * `syncAutoWinners` is deliberately inside here rather than at the call
   * sites: a save that skipped it would leave the HOOKLAB ledger asserting a
   * breakout the numbers no longer support.
   */
  const commit = useCallback(
    (next: PulsePost[]): boolean => {
      let ok = true;
      try {
        writeJSON(KEYS.pulsePosts, next);
      } catch {
        ok = false;
        setNotice({ tone: "error", text: SAVE_FAILED });
      }
      adopt(next);

      try {
        const r = syncAutoWinners(next);
        setPromoted(r.promoted);
        if (r.delta) {
          for (const id of r.delta.tombstone) tombstone("hooklabLedger", id);
          setAutoNotice(announceAuto(r.delta));
        }
      } catch {
        // A failure here must not lose the posts write that already landed.
      }
      return ok;
    },
    [adopt],
  );

  const saveSettings = useCallback((next: PulseSettings) => {
    settingsRef.current = next;
    setSettings(next);
    try {
      writeJSON(KEYS.pulseSettings, next);
    } catch {
      setNotice({ tone: "error", text: "Couldn't save settings." });
    }
  }, []);

  /**
   * Boot: heal, THEN paint.
   *
   * Both healers repair damage earlier importers did, and they run before the
   * first render so the creator never sees — or acts on — a split clip or a
   * duplicate twin. Order matters: `migrateClipIds` unifies ids so
   * `healImportTwins`, which groups by id, can then see the twins at all.
   */
  useEffect(() => {
    const loaded = readJSON<PulsePost[]>(KEYS.pulsePosts, []);
    const start = Array.isArray(loaded) ? loaded : [];

    const migrated = migrateClipIds(start);
    const healed = healImportTwins(migrated.posts);
    for (const id of healed.dropped) tombstone("pulsePost", id);

    if (migrated.changed || healed.merged) {
      commit(healed.posts);
      if (healed.merged) {
        setNotice({
          tone: "ok",
          text: `Merged ${healed.merged} duplicate import${
            healed.merged > 1 ? "s" : ""
          } — one post per clip per platform.`,
        });
      }
    } else {
      // Nothing to heal, but the auto set still needs computing for the badges.
      adopt(start);
      try {
        const r = syncAutoWinners(start);
        setPromoted(r.promoted);
        if (r.delta) {
          for (const id of r.delta.tombstone) tombstone("hooklabLedger", id);
          setAutoNotice(announceAuto(r.delta));
        }
      } catch {
        /* badges are cosmetic; a failure here must not block the section */
      }
    }
    // Intentionally once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Another tab — or a still-deployed legacy PULSE — writing posts shows up
  // here without a refresh.
  useEffect(
    () => subscribe(KEYS.pulsePosts, () => adopt(readJSON<PulsePost[]>(KEYS.pulsePosts, []))),
    [adopt],
  );

  const update = useCallback(
    (id: string, fn: (p: PulsePost) => PulsePost): void => {
      commit(postsRef.current.map((p) => (p.id === id ? fn(p) : p)));
    },
    [commit],
  );

  const record = useCallback(
    (id: string, data: ReadingInput, source: "auto" | "manual"): void => {
      update(id, (p) => recordSnapshot(p, data, source));
    },
    [update],
  );

  /** Judge a post. The ledger write comes first — no stamp without a row. */
  const setOutcome = useCallback(
    (id: string, outcome: Outcome): boolean => {
      const post = postsRef.current.find((p) => p.id === id);
      if (!post) return false;
      const r = logToLedger(post, outcome);
      if (!r.ok) {
        setNotice({
          tone: "error",
          text: "Couldn't write to the HOOKLAB ledger — storage is full or blocked.",
        });
        return false;
      }
      commit(postsRef.current.map((p) => (p.id === id ? r.post : p)));
      setNotice({ tone: "ok", text: `Logged as ${outcome} in your HOOKLAB ledger.` });
      return true;
    },
    [commit],
  );

  /** Stop tracking. The HOOKLAB ledger entry, if any, deliberately stays. */
  const stopTracking = useCallback(
    (id: string): void => {
      tombstone("pulsePost", id);
      commit(postsRef.current.filter((p) => p.id !== id));
      setNotice({ tone: "ok", text: "Stopped tracking." });
    },
    [commit],
  );

  /** Delete everywhere — including the ledger row this post wrote. */
  const deleteEverywhere = useCallback(
    (id: string): void => {
      const post = postsRef.current.find((p) => p.id === id);
      if (!post) return;
      tombstone("pulsePost", id);
      commit(postsRef.current.filter((p) => p.id !== id));
      // Only tombstone the ledger id when a row was actually removed —
      // otherwise a HOOKLAB-native entry could be suppressed by a sync.
      const removed = deleteLedgerEntry(post);
      if (removed) tombstone("hooklabLedger", "pulse_" + id);
      setNotice({
        tone: "ok",
        text: removed ? "Deleted here and from the HOOKLAB ledger." : "Deleted.",
      });
    },
    [commit],
  );

  const addPosts = useCallback(
    (newPosts: PulsePost[]): void => {
      commit([...newPosts, ...postsRef.current]);
    },
    [commit],
  );

  /** Pull everything BLAST has marked Posted. */
  const importBlast = useCallback((): void => {
    const session = readJSON<ClipRecord | null>(KEYS.blastSession, null);
    const queue = readJSON<unknown>(KEYS.blastQueue, null) ? loadQueue() : null;
    const r = importFromBlast(postsRef.current, queue, session);
    if (r.empty) {
      setNotice({
        tone: "error",
        text: "No BLAST session found in this browser — post something in BLAST first.",
      });
      return;
    }
    if (r.counters.added || r.counters.healed || r.counters.enriched) commit(r.posts);
    setNotice({ tone: "ok", text: importSummary(r) });
  }, [commit]);

  const importBackup = useCallback(
    (data: unknown): void => {
      const r = importBackupPosts(postsRef.current, data);
      commit(r.posts);
      setNotice({
        tone: "ok",
        text: `${r.added} post${r.added === 1 ? "" : "s"} imported from backup.`,
      });
    },
    [commit],
  );

  return {
    posts,
    settings,
    promoted,
    notice,
    autoNotice,
    clearNotice: () => setNotice(null),
    clearAutoNotice: () => setAutoNotice(null),
    setNotice,
    saveSettings,
    update,
    record,
    setOutcome,
    stopTracking,
    deleteEverywhere,
    addPosts,
    importBlast,
    importBackup,
    /** The committed posts, readable synchronously by async callers. */
    postsRef,
    settingsRef,
  };
}

/** Which clip cards are open. sessionStorage — a per-tab view preference. */
export function useExpanded() {
  const [keys, setKeys] = useState<Record<string, true>>(() => {
    const arr = readSessionJSON<string[]>(SESSION_KEYS.pulseExpanded, []);
    const out: Record<string, true> = {};
    for (const k of Array.isArray(arr) ? arr : []) out[k] = true;
    return out;
  });

  const toggle = useCallback((k: string) => {
    setKeys((cur) => {
      const next = { ...cur };
      if (next[k]) delete next[k];
      else next[k] = true;
      writeSessionJSON(SESSION_KEYS.pulseExpanded, Object.keys(next));
      return next;
    });
  }, []);

  return { keys, toggle };
}

/** The selected platform in the by-platform view. Also sessionStorage. */
export function usePlatformPick() {
  const [platform, setPlatform] = useState<string>(() =>
    readSessionJSON<string>(SESSION_KEYS.pulsePlatform, ""),
  );
  const pick = useCallback((name: string) => {
    setPlatform(name);
    writeSessionJSON(SESSION_KEYS.pulsePlatform, name);
  }, []);
  return { platform, pick };
}

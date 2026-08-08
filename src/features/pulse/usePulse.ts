import { useCallback, useEffect, useRef, useState } from "react";
import { KEYS, SESSION_KEYS } from "../../data/keys";
import {
  readJSON,
  readRaw,
  readSessionJSON,
  subscribe,
  writeJSON,
  writeRaw,
  writeSessionJSON,
} from "../../data/storage";
import { tombstone } from "../../data/stackdata/tombstones";
import { resolveKeys } from "../../data/stackdata/shared";
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
  // Healed in the INITIALIZER, not an effect: an effect runs after React
  // commits and the browser paints, so the creator would see — and could click
  // into — a split clip or a duplicate twin for a frame. Both healers are pure,
  // so this is a safe place for them; the effect below only persists the result.
  const [boot] = useState(() => {
    const loaded = readJSON<PulsePost[]>(KEYS.pulsePosts, []);
    const start = Array.isArray(loaded) ? loaded : [];
    const migrated = migrateClipIds(start);
    const healed = healImportTwins(migrated.posts);
    return { ...healed, changed: migrated.changed };
  });
  const [posts, setPosts] = useState<PulsePost[]>(boot.posts);
  // The YouTube key is SHARED across the stack, not PULSE's own. Settings
  // writes it to `stack_settings_v1`; reading only `pulse_settings_v1` here
  // meant a key entered in Settings never reached this section and
  // auto-tracking was dead for anyone who had not previously run legacy PULSE.
  // `resolveKeys` also promotes a legacy local-only key into the shared store,
  // and makes the shared value win — so clearing the key in Settings actually
  // stops this section using it.
  const [settings, setSettings] = useState<PulseSettings>(() =>
    resolveKeys(
      { ...DEFAULT_SETTINGS, ...readJSON<Partial<PulseSettings>>(KEYS.pulseSettings, {}) },
      ["ytKey"],
    ),
  );
  const [promoted, setPromoted] = useState<Record<string, true>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [autoNotice, setAutoNotice] = useState<string | null>(null);

  const postsRef = useRef(posts);
  /**
   * The exact string this hook last wrote.
   *
   * `writeRaw` notifies subscribers synchronously, so every save re-enters our
   * own listener. Comparing PARSED values there can never match — `readJSON`
   * builds a fresh object each call — so the echo was getting through: a
   * redundant state pass and a second `syncAutoWinners` on every keystroke-level
   * save, plus a re-parsed `posts` array that invalidated the grouping memos.
   * The raw string is the only thing that actually compares equal.
   */
  const lastWriteRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const adopt = useCallback((next: PulsePost[]) => {
    postsRef.current = next;
    setPosts(next);
  }, []);

  /**
   * Recompute the auto-promoted set and surface what changed.
   *
   * Shared by `commit` and the cross-tab subscriber: without it there, a legacy
   * tab recording a reading that drops a post out of the top decile would leave
   * this tab showing "AUTO IN HOOKLAB" on a hook whose ledger row the other tab
   * had already retracted.
   */
  const refreshAuto = useCallback((next: PulsePost[]) => {
    try {
      const r = syncAutoWinners(next);
      setPromoted(r.promoted);
      if (r.delta) {
        for (const id of r.delta.tombstone) tombstone("hooklabLedger", id);
        // Only replace the notice when there is something to say — a
        // figures-only refresh would otherwise clear a promotion message the
        // creator has not read yet.
        const msg = announceAuto(r.delta);
        if (msg) setAutoNotice(msg);
      }
    } catch {
      // Badges are cosmetic; a failure here must not lose a posts write that
      // already landed, nor block the section.
    }
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
      const raw = JSON.stringify(next);
      try {
        writeRaw(KEYS.pulsePosts, raw);
        lastWriteRef.current = raw;
      } catch {
        ok = false;
        setNotice({ tone: "error", text: SAVE_FAILED });
      }
      adopt(next);
      refreshAuto(next);
      return ok;
    },
    [adopt, refreshAuto],
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
   * Persist what the initializer healed, and compute the auto set for the
   * badges. The heal itself already happened, before the first paint.
   */
  useEffect(() => {
    for (const id of boot.dropped) tombstone("pulsePost", id);
    if (boot.changed || boot.merged) {
      commit(boot.posts);
      if (boot.merged) {
        setNotice({
          tone: "ok",
          text: `Merged ${boot.merged} duplicate import${
            boot.merged > 1 ? "s" : ""
          } — one post per clip per platform.`,
        });
      }
    } else {
      refreshAuto(boot.posts);
    }
    // Intentionally once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Another tab — or a still-deployed legacy PULSE — writing posts shows up
  // here without a refresh.
  useEffect(
    () =>
      subscribe(KEYS.pulsePosts, () => {
        const raw = readRaw(KEYS.pulsePosts);
        // Our own write re-enters here synchronously; only a write from
        // somewhere else is worth reacting to.
        if (raw === lastWriteRef.current) return;
        const next = readJSON<PulsePost[]>(KEYS.pulsePosts, []);
        adopt(Array.isArray(next) ? next : []);
        refreshAuto(Array.isArray(next) ? next : []);
      }),
    [adopt, refreshAuto],
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

  const ref = useRef(keys);

  // The write stays OUT of the updater: a render React discards still leaves a
  // side effect behind, so `pulse_expanded_v1` would describe a UI state that
  // never rendered. `usePlatformPick` below already does it this way.
  const toggle = useCallback((k: string) => {
    const next = { ...ref.current };
    if (next[k]) delete next[k];
    else next[k] = true;
    ref.current = next;
    writeSessionJSON(SESSION_KEYS.pulseExpanded, Object.keys(next));
    setKeys(next);
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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  driveErrMsg,
  driveFindQuery,
  findLeakedKeys,
  getSyncMeta,
  setSyncMeta,
  driveFind,
  driveDownload,
} from "../../src/data/stackdata/drive";
import { KEYS } from "../../src/data/keys";
import type { StackBackup } from "../../src/data/schemas/stack";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function backup(ls: Record<string, string>): StackBackup {
  return {
    format: "mjm-stack-backup",
    version: 2,
    exportedAt: "2026-08-06T00:00:00.000Z",
    localStorage: ls,
    recallLibrary: null,
  };
}

describe("file discovery", () => {
  it("scopes the query to this workspace, not just the app", () => {
    // Without the ws clause, two stacks on one Google account share a file and
    // silently overwrite each other.
    const q = driveFindQuery("ws_abc");
    expect(q).toContain("key='app' and value='mjm-stack'");
    expect(q).toContain("key='ws' and value='ws_abc'");
    expect(q).toContain("trashed=false");
  });

  it("prefers a stored fileId only when it belongs to this workspace", async () => {
    setSyncMeta({ fileId: "stored-id", wsId: "ws_mine" });
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: [{ id: "other-id" }, { id: "stored-id" }] }),
      } as unknown as Response),
    );

    // Same workspace: the remembered file wins over list order.
    expect((await driveFind("t", "ws_mine"))?.id).toBe("stored-id");
    // Different workspace: the stored id is not ours to trust.
    expect((await driveFind("t", "ws_other"))?.id).toBe("other-id");
  });

  it("returns null when the workspace has no file yet", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: [] }),
      } as unknown as Response),
    );
    expect(await driveFind("t", "ws")).toBeNull();
  });
});

describe("download", () => {
  it("forgets a fileId that Drive says is gone", async () => {
    // Otherwise every future sync retries a deleted file and fails forever.
    setSyncMeta({ fileId: "dead-id", wsId: "ws" });
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: false, status: 404 } as unknown as Response),
    );

    expect(await driveDownload("t", "dead-id")).toBeNull();
    expect(getSyncMeta().fileId).toBe("");
  });
});

describe("sync bookkeeping", () => {
  it("patches rather than replaces, under the legacy key", () => {
    setSyncMeta({ fileId: "f1", wsId: "ws1" });
    setSyncMeta({ lastSyncAt: 1234 });
    expect(getSyncMeta()).toEqual({ fileId: "f1", wsId: "ws1", lastSyncAt: 1234 });
    expect(localStorage.getItem(KEYS.stackSyncMeta)).toContain("f1");
  });

  it("stores lastSyncAt as a number, matching what the legacy apps read", () => {
    // The still-deployed apps read this key on the same origin to decide
    // whether to force the Google consent prompt.
    setSyncMeta({ lastSyncAt: Date.now() });
    expect(typeof getSyncMeta().lastSyncAt).toBe("number");
  });
});

describe("upload leak check", () => {
  it("catches every excluded key, so no secret can reach Drive", () => {
    const poisoned = backup({
      stack_settings_v1: '{"geminiKey":"AIzaSECRET"}',
      hooklab_state_v1: '{"ledger":[]}',
    });
    expect(findLeakedKeys(poisoned)).toContain("stack_settings_v1");
  });

  it("catches the stale BLAST projection too, not just API keys", () => {
    // blast_session_v1 is excluded for correctness, not privacy: syncing it let
    // a stale device win newest-wins and clobber real work.
    expect(findLeakedKeys(backup({ blast_session_v1: "{}" }))).toContain("blast_session_v1");
  });

  it("passes a clean payload", () => {
    expect(findLeakedKeys(backup({ pulse_posts_v1: "[]" }))).toEqual([]);
  });
});

describe("Drive error messages", () => {
  it("names the Drive API being disabled, with the path to fix it", () => {
    // A bare "403" sends people hunting; this is the most common first-run
    // failure and the fix is four clicks deep in Cloud Console.
    const msg = driveErrMsg({ status: 403, reason: "accessNotConfigured", message: "" });
    expect(msg).toMatch(/Drive API/i);
    expect(msg).toMatch(/Enable/i);
  });

  it("distinguishes a revoked scope from a full disk from a rate limit", () => {
    expect(driveErrMsg({ status: 403, reason: "insufficientPermissions", message: "" })).toMatch(
      /permission/i,
    );
    expect(driveErrMsg({ status: 403, reason: "storageQuotaExceeded", message: "" })).toMatch(
      /full/i,
    );
    expect(driveErrMsg({ status: 403, reason: "userRateLimitExceeded", message: "" })).toMatch(
      /rate-limiting/i,
    );
  });

  it("falls back to the server's own message, then to generic advice", () => {
    expect(driveErrMsg({ status: 500, message: "Backend error" })).toBe("Backend error");
    expect(driveErrMsg({})).toMatch(/check your connection/i);
    expect(driveErrMsg(null)).toMatch(/check your connection/i);
  });
});

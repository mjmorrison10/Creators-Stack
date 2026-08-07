/**
 * Google Drive sync — ported from stackdata.js lines 502-670.
 *
 * Scope is `drive.file` only, so the app can see nothing in Drive it did not
 * create. The OAuth client id is a public Web client id; the token flow carries
 * no secret, and there is no backend.
 *
 * One file per workspace, discovered by appProperties rather than by name, so
 * renaming the file in Drive's UI doesn't orphan it and two stacks on one
 * Google account never fight over the same file.
 */

import { KEYS } from "../keys";
import { readJSON, writeJSON } from "../storage";
import {
  DRIVE_CLIENT_ID,
  DRIVE_SCOPE,
  SYNC_EXCLUDE,
  isDriveConfigured,
  syncFileName,
  syncMarker,
} from "./constants";
import { exportAll, importAll, isStackBackup } from "./backup";
import { mergeStates } from "./merge";
import { ensureWorkspace, workspaceConflict } from "./workspace";
import type { MergeReport, StackBackup, SyncMeta, Workspace } from "../schemas/stack";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GIS_TIMEOUT_MS = 10_000;
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

interface TokenClient {
  callback: (resp: { access_token?: string }) => void;
  error_callback: (e: unknown) => void;
  requestAccessToken: (opts: { prompt: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (cfg: Record<string, unknown>) => TokenClient;
        };
      };
    };
  }
}

let tokenClient: TokenClient | null = null;

export function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();

    const existing = document.getElementById("gis-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Couldn't load Google sign-in")));
      return;
    }

    const s = document.createElement("script");
    s.id = "gis-script";
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    const to = setTimeout(
      () => reject(new Error("Couldn't load Google sign-in (network?)")),
      GIS_TIMEOUT_MS,
    );
    s.onload = () => {
      clearTimeout(to);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(to);
      reject(new Error("Couldn't load Google sign-in (network?)"));
    };
    document.head.appendChild(s);
  });
}

function mapGisError(err: unknown): Error {
  const e = err as { type?: string; message?: string } | null;
  const t = e?.type || e?.message || "";
  if (/popup_closed|closed/i.test(t)) return new Error("Sign-in was cancelled");
  if (/popup_failed|blocked/i.test(t)) {
    return new Error("Sign-in popup was blocked — allow popups and retry");
  }
  return new Error("Google sign-in failed");
}

export async function getAccessToken(forcePrompt = false): Promise<string> {
  await loadGis();
  return new Promise<string>((resolve, reject) => {
    const onResp = (resp: { access_token?: string }): void => {
      if (resp?.access_token) resolve(resp.access_token);
      else reject(new Error("No access token"));
    };
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) return reject(new Error("Google sign-in unavailable"));

    if (!tokenClient) {
      tokenClient = oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: onResp,
        error_callback: (e: unknown) => reject(mapGisError(e)),
      });
    } else {
      tokenClient.callback = onResp;
      tokenClient.error_callback = (e: unknown) => reject(mapGisError(e));
    }

    const meta = getSyncMeta();
    tokenClient.requestAccessToken({
      prompt: forcePrompt ? "consent" : meta.lastSyncAt ? "" : "consent",
    });
  });
}

export interface DriveHttpError {
  status: number;
  reason: string;
  message: string;
}

/** Read Google's error body so callers get the REAL reason, not just a code. */
async function httpErr(res: Response): Promise<DriveHttpError> {
  try {
    const t = await res.text();
    let reason = "";
    let message = "";
    try {
      const e = (JSON.parse(t) as { error?: Record<string, unknown> }).error ?? {};
      message = String(e.message ?? "");
      const errs = e.errors as { reason?: string }[] | undefined;
      reason = errs?.[0]?.reason ?? String(e.status ?? "");
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, reason, message };
  } catch {
    return { status: res.status, reason: "", message: "" };
  }
}

export async function driveFetch(
  token: string,
  url: string,
  opts: RequestInit = {},
  retried = false,
): Promise<Response> {
  const headers = { ...(opts.headers as Record<string, string>), Authorization: `Bearer ${token}` };
  const res = await fetch(url, { ...opts, headers });
  // One forced re-consent on an expired token, then give up.
  if (res.status === 401 && !retried) {
    const t2 = await getAccessToken(true);
    return driveFetch(t2, url, opts, true);
  }
  return res;
}

export interface DriveFile {
  id: string;
  modifiedTime?: string;
}

export function driveFindQuery(wsId: string): string {
  return (
    `appProperties has { key='app' and value='mjm-stack' } and ` +
    `appProperties has { key='ws' and value='${wsId}' } and trashed=false`
  );
}

export async function driveFind(token: string, wsId: string): Promise<DriveFile | null> {
  const url =
    `${DRIVE_FILES}?q=${encodeURIComponent(driveFindQuery(wsId))}` +
    `&fields=files(id,modifiedTime)&pageSize=10`;
  const res = await driveFetch(token, url, { method: "GET" });
  if (!res.ok) throw await httpErr(res);

  const j = (await res.json()) as { files?: DriveFile[] };
  const files = j.files ?? [];
  if (!files.length) return null;

  // Only trust a stored fileId if it belongs to THIS workspace.
  const meta = getSyncMeta();
  if (meta.fileId && meta.wsId === wsId) {
    const match = files.find((f) => f.id === meta.fileId);
    if (match) return match;
  }
  return files[0] ?? null;
}

export async function driveDownload(token: string, id: string): Promise<StackBackup | null> {
  const res = await driveFetch(token, `${DRIVE_FILES}/${id}?alt=media`, { method: "GET" });
  // The file was deleted in Drive — forget the id rather than failing forever.
  if (res.status === 404) {
    setSyncMeta({ fileId: "" });
    return null;
  }
  if (!res.ok) throw await httpErr(res);
  return (await res.json()) as StackBackup;
}

export async function driveCreate(
  token: string,
  name: string,
  props: Record<string, string>,
  obj: unknown,
): Promise<string> {
  const boundary = `mjmstack${Math.random().toString(36).slice(2)}`;
  const meta = { name, mimeType: "application/json", appProperties: props };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}` +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}` +
    `\r\n--${boundary}--`;

  const res = await driveFetch(token, `${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw await httpErr(res);
  return ((await res.json()) as { id: string }).id;
}

export async function driveUpdate(token: string, id: string, obj: unknown): Promise<string> {
  const res = await driveFetch(token, `${DRIVE_UPLOAD}/${id}?uploadType=media&fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  if (!res.ok) throw await httpErr(res);
  return ((await res.json()) as { id: string }).id;
}

/**
 * Turn a Drive failure into something the user can act on. A bare "403" sends
 * people hunting; naming the actual cause (Drive API not enabled, scope
 * revoked, disk full, rate limit) tells them what to click.
 */
export function driveErrMsg(e: unknown): string {
  const err = e as Partial<DriveHttpError> & { message?: string };
  const s = err?.status;
  const blob = `${err?.reason ?? ""} ${err?.message ?? ""}`.toLowerCase();
  const m = err?.message ?? "";

  if (s === 403) {
    if (/accessnotconfigured|has not been used|is disabled|not been enabled/.test(blob)) {
      return (
        "Google Drive isn't enabled for your Cloud project yet — turn on the Drive API " +
        "(Google Cloud > APIs & Services > Library > Google Drive API > Enable), " +
        "wait about a minute, then Sync again."
      );
    }
    if (/insufficient(permissions|scopes)|scope/.test(blob)) {
      return (
        "Sync doesn't have Drive permission — reload and approve the Google prompt again " +
        "(it needs the drive.file access)."
      );
    }
    if (/storagequota/.test(blob)) return "Your Google Drive is full — free up space and try again.";
    if (/ratelimit|userratelimit|dailylimit|quotaexceeded/.test(blob)) {
      return "Google Drive is rate-limiting sync — wait a minute and try again.";
    }
    return (
      `Google Drive refused the request (403)` +
      (m ? `: ${m}` : " — check the Drive API is enabled and access is still granted.")
    );
  }
  if (m) return m;
  return "Drive sync failed — check your connection and try again";
}

export function getSyncMeta(): Partial<SyncMeta> {
  return readJSON<Partial<SyncMeta>>(KEYS.stackSyncMeta, {});
}

export function setSyncMeta(patch: Partial<SyncMeta>): void {
  writeJSON(KEYS.stackSyncMeta, { ...getSyncMeta(), ...patch });
}

export function isSyncConfigured(): boolean {
  return isDriveConfigured();
}

export interface SyncCallbacks {
  onStatus?: (msg: string) => void;
  onErr?: (msg: string) => void;
  onDone?: (report: MergeReport | null) => void;
  /**
   * Asked only when Drive holds a file that isn't a recognizable backup.
   * Returning false aborts rather than overwriting something unknown.
   */
  confirmOverwriteForeign?: () => Promise<boolean>;
  workspaceName?: string;
}

/** Keys that must never reach Drive, checked immediately before upload. */
export function findLeakedKeys(payload: StackBackup): string[] {
  const ls = payload.localStorage ?? {};
  return SYNC_EXCLUDE.filter((k) => ls[k] != null);
}

/**
 * Pull the Drive copy, merge, apply locally, push the result.
 *
 * Unlike the legacy version this does not reload the page on success —
 * storage writes already notify subscribers, so React re-renders on its own.
 */
export async function syncDrive(cb: SyncCallbacks = {}): Promise<boolean> {
  const status = cb.onStatus ?? (() => {});
  const onErr = cb.onErr ?? (() => {});
  const onDone = cb.onDone ?? (() => {});

  if (!isDriveConfigured()) {
    onErr("Drive sync isn't set up yet (owner setup pending)");
    return false;
  }

  const ws: Workspace = ensureWorkspace(cb.workspaceName);

  try {
    status("Connecting to Google Drive…");
    const token = await getAccessToken();
    const local = await exportAll({ forSync: true });

    status("Checking Drive…");
    const found = await driveFind(token, ws.id);
    const remote = found ? await driveDownload(token, found.id) : null;

    let payload: StackBackup = local;
    let report: MergeReport | null = null;

    if (remote) {
      if (!isStackBackup(remote)) {
        const ok = cb.confirmOverwriteForeign ? await cb.confirmOverwriteForeign() : false;
        if (!ok) return false;
      } else {
        const conflict = workspaceConflict(local, remote);
        if (conflict) {
          onErr(
            `Sync blocked: your Drive holds workspace "${conflict.remoteName}", but this ` +
              `device is "${conflict.localName}". Use STACK RESTORE to switch this device entirely.`,
          );
          return false;
        }
        status("Merging…");
        const merged = mergeStates(local, remote);
        payload = merged.data;
        report = merged.report;
        await importAll(payload);
      }
    }

    // Defence in depth: never upload a payload carrying excluded secrets, even
    // if some earlier stage let one through.
    const leaked = findLeakedKeys(payload);
    if (leaked.length) {
      onErr("Sync aborted: refused to upload sensitive keys");
      return false;
    }

    status("Uploading…");
    const stored = getSyncMeta();
    const fileId = found?.id ?? (stored.wsId === ws.id ? (stored.fileId ?? null) : null);
    let id: string;
    if (fileId) {
      // A stored id can point at a file that's been deleted; fall back to
      // creating rather than failing the whole sync.
      id = await driveUpdate(token, fileId, payload).catch(() =>
        driveCreate(token, syncFileName(ws), syncMarker(ws) as unknown as Record<string, string>, payload),
      );
    } else {
      id = await driveCreate(
        token,
        syncFileName(ws),
        syncMarker(ws) as unknown as Record<string, string>,
        payload,
      );
    }

    setSyncMeta({ fileId: id, wsId: ws.id, lastSyncAt: Date.now() });
    onDone(report);
    status(remote ? "Synced" : "First sync — uploaded this device");
    return true;
  } catch (e) {
    onErr(driveErrMsg(e));
    return false;
  }
}

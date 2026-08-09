import { useCallback, useRef, useState } from "react";
import { SectionHeader } from "../../components/SectionHeader";
import { Button, Card, Field, Modal, StatusLine, TextInput } from "../../components/ui";
import { KEYS } from "../../data/keys";
import { useStackKey } from "../../data/hooks";
import {
  clearSharedKey,
  readSharedKeys,
  writeSharedKeys,
  type SharedKeyField,
} from "../../data/stackdata/shared";
import { exportAll, importAll, isStackBackup, summary } from "../../data/stackdata/backup";
import { mergeStates, WorkspaceMismatchError } from "../../data/stackdata/merge";
import { getWorkspace } from "../../data/stackdata/workspace";
import { isSyncConfigured, syncDrive, getSyncMeta } from "../../data/stackdata/drive";
import type { StackBackup } from "../../data/schemas/stack";
import { ThemeControl } from "./ThemeControl";

type Tone = "info" | "error" | "ok";

function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readFileAsJson(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        resolve(JSON.parse(String(r.result)));
      } catch {
        reject(new Error("That file isn't valid JSON"));
      }
    };
    r.onerror = () => reject(new Error("Couldn't read that file"));
    r.readAsText(file);
  });
}

/** API keys live only on this device — they are excluded from every sync. */
function KeysCard() {
  const [keys, setKeys] = useState(() => readSharedKeys());
  const [saved, setSaved] = useState(false);

  const update = (field: SharedKeyField, value: string): void => {
    setKeys((k) => ({ ...k, [field]: value }));
    setSaved(false);
  };

  const save = (): void => {
    for (const f of ["geminiKey", "openrouterKey", "openrouterModel", "ytKey"] as SharedKeyField[]) {
      const v = (keys[f] ?? "") as string;
      // Blanking a field must clear it stack-wide; writeSharedKeys ignores
      // empty values by design, so an explicit clear is a separate call.
      if (v === "") clearSharedKey(f);
    }
    writeSharedKeys(keys);
    setSaved(true);
  };

  return (
    <Card
      title="API KEYS"
      hint="Stored in this browser only. Keys are excluded from backups and never reach Google Drive."
    >
      <Field label="Gemini API key" hint="Needed for transcription and video analysis.">
        <TextInput
          type="password"
          value={(keys.geminiKey as string) ?? ""}
          onChange={(v) => update("geminiKey", v)}
          placeholder="AIza…"
        />
      </Field>
      <Field label="OpenRouter API key" hint="Optional — an alternative text provider.">
        <TextInput
          type="password"
          value={(keys.openrouterKey as string) ?? ""}
          onChange={(v) => update("openrouterKey", v)}
          placeholder="sk-or-…"
        />
      </Field>
      <Field label="OpenRouter model" hint="Picker arrives with the BLAST section.">
        <TextInput
          value={(keys.openrouterModel as string) ?? ""}
          onChange={(v) => update("openrouterModel", v)}
          placeholder="anthropic/claude-sonnet-4.6"
        />
      </Field>
      <Field label="YouTube Data API key" hint="Lets PULSE fill in view counts automatically.">
        <TextInput
          type="password"
          value={(keys.ytKey as string) ?? ""}
          onChange={(v) => update("ytKey", v)}
        />
      </Field>
      <Button onClick={save} variant="primary">
        SAVE KEYS
      </Button>
      {saved && <StatusLine tone="ok">Saved — these keys now work across every section.</StatusLine>}
    </Card>
  );
}

interface PendingRestore {
  data: StackBackup;
  mode: "replace" | "merge";
}

function BackupCard() {
  const [status, setStatus] = useState<{ tone: Tone; text: string } | null>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);

  const doExport = async (): Promise<void> => {
    const data = await exportAll();
    downloadJson(data, `mjm-stack-backup-${today()}.json`);
    setStatus({ tone: "ok", text: `Downloaded — ${summary(data)}` });
  };

  const pick = async (file: File | undefined, mode: "replace" | "merge"): Promise<void> => {
    if (!file) return;
    try {
      const data = await readFileAsJson(file);
      if (!isStackBackup(data)) {
        setStatus({ tone: "error", text: "That isn't a stack backup file" });
        return;
      }
      setPending({ data, mode });
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error).message });
    }
  };

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    const { data, mode } = pending;
    setPending(null);
    try {
      if (mode === "replace") {
        await importAll(data, { replace: true });
        setStatus({ tone: "ok", text: "Restored. This device now matches the backup." });
      } else {
        const local = await exportAll();
        const merged = mergeStates(local, data);
        await importAll(merged.data);
        const { sources, posts, ledger, comps } = merged.report.added;
        setStatus({
          tone: "ok",
          text: `Merged — ${sources} sources, ${posts} posts, ${ledger} ledger entries, ${comps} comps.`,
        });
      }
    } catch (e) {
      if (e instanceof WorkspaceMismatchError) {
        setStatus({
          tone: "error",
          text: `That file is from workspace "${e.remoteName}", but this device is "${e.localName}". Use RESTORE to switch this device entirely.`,
        });
        return;
      }
      setStatus({ tone: "error", text: (e as Error).message });
    }
  };

  return (
    <Card
      title="BACKUP"
      hint="One file holds every section's data. Merge combines two devices; restore replaces this one."
    >
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void doExport()}>DOWNLOAD BACKUP</Button>
        <Button onClick={() => restoreInput.current?.click()} variant="danger">
          RESTORE (REPLACE)
        </Button>
        <Button onClick={() => mergeInput.current?.click()}>MERGE A FILE</Button>
      </div>

      <input
        ref={restoreInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0], "replace");
          e.target.value = "";
        }}
      />
      <input
        ref={mergeInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0], "merge");
          e.target.value = "";
        }}
      />

      {status && <StatusLine tone={status.tone}>{status.text}</StatusLine>}

      {pending && (
        <Modal
          title={pending.mode === "replace" ? "RESTORE THIS BACKUP?" : "MERGE THIS FILE?"}
          onClose={() => setPending(null)}
          actions={
            <>
              <Button onClick={() => setPending(null)}>CANCEL</Button>
              <Button
                onClick={() => void confirm()}
                variant={pending.mode === "replace" ? "danger" : "primary"}
              >
                {pending.mode === "replace" ? "REPLACE MY DATA" : "MERGE"}
              </Button>
            </>
          }
        >
          {/* Say what the file holds before overwriting anything — the summary
              is the only chance to notice you grabbed the wrong file. */}
          <p className="mb-2">
            Contains: <strong>{summary(pending.data)}</strong>
          </p>
          {pending.mode === "replace" ? (
            <p className="text-muted">
              This <strong>replaces</strong> the clip library, hook ledger, posting queue and tracked
              posts on this device. Your API keys and theme are kept.
            </p>
          ) : (
            <p className="text-muted">
              This combines the file with what you already have. Nothing is deleted.
            </p>
          )}
        </Modal>
      )}
    </Card>
  );
}

function SyncCard() {
  const [status, setStatus] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const ws = getWorkspace();
  const meta = getSyncMeta();

  const run = useCallback(async (workspaceName?: string) => {
    setBusy(true);
    setStatus({ tone: "info", text: "Starting…" });
    try {
      await syncDrive({
        workspaceName,
        onStatus: (text) => setStatus({ tone: "info", text }),
        onErr: (text) => setStatus({ tone: "error", text }),
        onDone: (report) => {
          if (!report) return;
          const { sources, posts, ledger, comps } = report.added;
          setStatus({
            tone: "ok",
            text: `Synced — ${sources} sources, ${posts} posts, ${ledger} ledger entries, ${comps} comps.`,
          });
        },
        // Never overwrite a file we don't recognize without being told to.
        confirmOverwriteForeign: async () =>
          window.confirm(
            "The file already in your Drive isn't a recognizable stack backup. " +
              "Overwrite it with this device's data?",
          ),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const start = (): void => {
    // First sync names the workspace, so a second stack on the same Google
    // account gets its own file instead of fighting over one.
    if (!ws) {
      setNaming(true);
      return;
    }
    void run();
  };

  return (
    <Card
      title="GOOGLE DRIVE SYNC"
      hint="Merges this device with your Drive copy. Only files this app created are visible to it."
    >
      <p className="mb-4 text-sm text-muted">
        {ws ? (
          <>
            Workspace <strong className="text-ink">{ws.name}</strong>
            {meta.lastSyncAt
              ? ` · last synced ${new Date(meta.lastSyncAt).toLocaleString()}`
              : " · never synced"}
          </>
        ) : (
          "No workspace yet — the first sync creates one."
        )}
        {!isSyncConfigured() && " · Drive setup pending"}
      </p>

      <Button onClick={start} variant="primary" disabled={busy}>
        {busy ? "SYNCING…" : "SYNC DRIVE"}
      </Button>

      {status && <StatusLine tone={status.tone}>{status.text}</StatusLine>}

      {naming && (
        <Modal
          title="NAME THIS WORKSPACE"
          onClose={() => setNaming(false)}
          actions={
            <>
              <Button onClick={() => setNaming(false)}>CANCEL</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setNaming(false);
                  void run(name);
                }}
              >
                START SYNC
              </Button>
            </>
          }
        >
          <p className="mb-3 text-muted">
            Shown when syncing, and used to name the file in your Drive. One Google account can hold
            several workspaces without them mixing.
          </p>
          <TextInput value={name} onChange={setName} placeholder="e.g. your name or brand" />
        </Modal>
      )}
    </Card>
  );
}

export function SettingsSection() {
  // Read purely to prove the theme key round-trips through the same layer.
  useStackKey<string>(KEYS.stackTheme, "system");

  return (
    <>
      <SectionHeader
        name="SETTINGS"
        tagline="Keys, backup, and Google Drive sync for the whole stack."
        accent="text-ink"
      />
      <KeysCard />
      <BackupCard />
      <SyncCard />
      <ThemeControl />
    </>
  );
}

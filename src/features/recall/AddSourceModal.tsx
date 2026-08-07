import { useState } from "react";
import { Button, Field, Modal, StatusLine, TextInput } from "../../components/ui";
import { detectFormat, parse } from "../../domain/recall/parse";

const FORMAT_LABEL: Record<string, string> = {
  srt: "SRT / WebVTT cues",
  inline: "TurboScribe inline timecodes",
  legacy: "timestamped lines",
};

/**
 * Paste a transcript, see what RECALL made of it, then keep it.
 *
 * The preview exists because the parser's job is invisible otherwise: a
 * transcript in an unrecognized shape parses to one enormous moment and the
 * user would only find out later, when search returned nothing useful.
 */
export function AddSourceModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (title: string, raw: string) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const segments = raw.trim() ? parse(raw) : [];
  const format = raw.trim() ? detectFormat(raw) : null;

  const reset = (): void => {
    setTitle("");
    setRaw("");
    setError(null);
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const submit = async (): Promise<void> => {
    if (!segments.length) {
      setError("Nothing parsed out of that. Timecodes look like [00:01:23] or (0:04 - 0:23).");
      return;
    }
    setSaving(true);
    try {
      await onAdd(title, raw);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that source.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={close}
      title="ADD A SOURCE"
      actions={
        <>
          <Button onClick={close}>CANCEL</Button>
          <Button
            onClick={() => void submit()}
            variant="primary"
            disabled={saving || !segments.length}
          >
            {saving ? "SAVING…" : "ADD SOURCE"}
          </Button>
        </>
      }
    >
      <Field label="Title" hint="How it appears in the source tray.">
        <TextInput value={title} onChange={setTitle} placeholder="e.g. Podcast ep. 41" />
      </Field>
      <Field
        label="Transcript"
        hint="SRT, WebVTT, TurboScribe copy, or plain timestamped lines."
      >
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={10}
          placeholder="[00:00:05] Discipline is just remembering what you want."
          className="w-full rounded-lg border border-edge bg-ground px-3 py-2 font-mono text-xs text-ink"
        />
      </Field>

      {raw.trim() && (
        <div className="rounded-lg border border-edge bg-surface2 p-3">
          <p className="font-mono text-[10px] tracking-[0.08em] text-faint">
            READ AS {FORMAT_LABEL[format ?? "legacy"]} — {segments.length}{" "}
            {segments.length === 1 ? "MOMENT" : "MOMENTS"}
          </p>
          {segments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {segments.slice(0, 3).map((s, i) => (
                <li key={i} className="text-xs text-muted">
                  <span className="font-mono text-recall">{s.t}</span> {s.text.slice(0, 90)}
                  {s.text.length > 90 && "…"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <StatusLine tone="error">{error}</StatusLine>}
    </Modal>
  );
}

import { useState } from "react";
import { Button, Card, Field, TextInput } from "../../components/ui";
import type { PulsePost, PulseSettings } from "../../data/schemas/pulse";
import { readPresets } from "../../domain/blast/compose";
import { PLATFORMS, platformForUrl, runningPlatforms } from "../../domain/pulse/snapshots";
import { captionHook, HOOK_MAX, uid } from "../../domain/pulse/import";

/** A datetime-local value for "now", in the browser's own timezone. */
function localNow(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/**
 * Track a post PULSE didn't import — something posted before the stack, or
 * from a phone.
 *
 * The platform checkboxes are a STORED preference. They used to be re-derived
 * from BLAST on every sync, which silently un-ticked choices the creator had
 * made; now the list only changes when they change it.
 */
export function AddPostForm({
  posts,
  settings,
  onSaveSettings,
  onAdd,
}: {
  posts: PulsePost[];
  settings: PulseSettings;
  onSaveSettings: (s: PulseSettings) => void;
  onAdd: (created: PulsePost[]) => void;
}) {
  const offered = runningPlatforms(
    settings.platforms,
    [...new Set(posts.map((p) => p.platform))],
    Object.keys(readPresets()),
  );
  const [picked, setPicked] = useState<string[]>(offered);
  const [hook, setHook] = useState("");
  const [caption, setCaption] = useState("");
  const [url, setUrl] = useState("");
  const [at, setAt] = useState(localNow());
  const [error, setError] = useState<string | null>(null);

  const toggle = (name: string): void => {
    setPicked((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  };

  const submit = (): void => {
    if (!picked.length) {
      setError("Pick at least one platform.");
      return;
    }
    setError(null);
    // Remember the picks for next time, in display order.
    onSaveSettings({ ...settings, platforms: PLATFORMS.filter((n) => picked.includes(n)) });

    const parsed = at ? new Date(at).getTime() : NaN;
    const postedAt = Number.isNaN(parsed) || !parsed ? Date.now() : parsed;
    const trimmed = url.trim();
    // One link belongs to one platform — the one it points at. Copying it to
    // all of them would send every later stats check at the wrong post.
    const linkOwner = trimmed ? (platformForUrl(trimmed) ?? picked[0]) : null;
    const h = hook.trim() || captionHook(caption);

    const created = PLATFORMS.filter((n) => picked.includes(n)).map(
      (platform): PulsePost => ({
        id: uid(),
        platform,
        url: platform === linkOwner ? trimmed : "",
        caption: caption.trim(),
        hook: h.slice(0, HOOK_MAX),
        postedAt,
        snapshots: [],
        outcome: null,
        ledgerLoggedAt: null,
        // No clipId: hand-added posts group by their hook and are deliberately
        // invisible to the twin healer, which only ever merges imports.
      }),
    );

    onAdd(created);
    setHook("");
    setCaption("");
    setUrl("");
  };

  return (
    <Card title="ADD A POST" hint="For anything PULSE didn't import — posted from a phone, or before the stack.">
      <fieldset className="mb-4">
        <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint">
          PLATFORMS
        </legend>
        <ul className="flex flex-wrap gap-2">
          {offered.map((name) => (
            <li key={name}>
              <label
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-sm transition ${
                  picked.includes(name)
                    ? "border-pulse bg-surface2 text-ink"
                    : "border-edge text-faint"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={picked.includes(name)}
                  onChange={() => toggle(name)}
                />
                {name}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <Field label="Hook" hint="The first line you say on camera.">
        <TextInput value={hook} onChange={setHook} />
      </Field>
      <Field label="Caption" hint="Optional — its first line becomes the hook if you leave that blank.">
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink"
        />
      </Field>
      <Field label="Link" hint="Optional — attaches to whichever platform it points at.">
        <TextInput value={url} onChange={setUrl} />
      </Field>
      <Field label="Posted at" hint="Checkpoints count from here, so it's worth getting right.">
        <input
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          className="rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink"
        />
      </Field>

      {error && <p className="mb-3 text-sm text-gold">{error}</p>}

      <Button onClick={submit} variant="primary">
        TRACK {picked.length} POST{picked.length === 1 ? "" : "S"}
      </Button>
    </Card>
  );
}

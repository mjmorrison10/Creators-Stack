import { useState } from "react";
import { SectionHeader } from "../../components/SectionHeader";
import { Button, Card, Field, StatusLine, TextInput } from "../../components/ui";
import { SECTIONS } from "../../sections";
import { PLATFORMS, platformByName, STATUS_LABEL } from "../../domain/blast/platforms";
import { readPresets, setPreset, writePresets } from "../../domain/blast/compose";
import { QUICK_KEY, selectedNames } from "../../domain/blast/queue";
import { useBlast } from "./useBlast";
import { PlatformCard } from "./PlatformCard";
import { SuggestPanel } from "./SuggestPanel";

const meta = SECTIONS[2]!;

/** Queue rail: Quick is pinned first and permanent; the rest came from RECALL. */
function QueueRail({
  blast,
}: {
  blast: ReturnType<typeof useBlast>;
}) {
  return (
    <div className="mb-5">
      <h2 className="mb-2 font-mono text-[10px] tracking-[0.14em] text-faint">
        QUEUE {blast.queue.clips.length}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {blast.queue.clips.map((p) => {
          const on = p.key === blast.activeKey;
          const done = Object.values(p.status).filter(
            (s) => s === "posted" || s === "skipped",
          ).length;
          return (
            <li key={p.key} className="flex items-center gap-1.5">
              <button
                onClick={() => blast.setActiveKey(p.key)}
                aria-pressed={on}
                className={`rounded-lg border px-2.5 py-1.5 text-sm transition ${
                  on ? "border-blast bg-surface2 text-blast" : "border-edge text-muted hover:text-ink"
                }`}
              >
                {p.key === QUICK_KEY ? "Quick post" : p.srcTitle || p.text.slice(0, 28) || "Clip"}
                {done > 0 && <span className="ml-1.5 font-mono text-[10px] text-pos">{done}✓</span>}
              </button>
              {p.key !== QUICK_KEY && (
                <button
                  onClick={() => blast.remove(p.key)}
                  aria-label={`Remove ${p.srcTitle || "clip"} from the queue`}
                  className="text-faint transition hover:text-gold"
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BlastSection() {
  const blast = useBlast();
  const [presets, setPresets] = useState(() => readPresets());
  const [showPresets, setShowPresets] = useState(false);

  const post = blast.active;
  const names = selectedNames(blast.queue, post);
  const chosen = post.platforms ?? blast.queue.defaultPlatforms ?? null;

  const togglePlatform = (name: string): void => {
    const cur = chosen ?? PLATFORMS.map((p) => p.name);
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    blast.mutate(post.key, (p) => ({ ...p, platforms: next }));
  };

  const savePreset = (name: string, template: string): void => {
    const next = setPreset(presets, name, template);
    setPresets(next);
    writePresets(next);
  };

  const posted = names.filter((n) => post.status[n] === "posted").length;

  return (
    <>
      <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />

      {blast.notice && <StatusLine tone="error">{blast.notice}</StatusLine>}

      <QueueRail blast={blast} />

      <Card
        title={post.key === QUICK_KEY ? "QUICK POST" : post.srcTitle || "CLIP"}
        hint="One caption, adapted per platform. Nothing is posted for you — BLAST copies and opens."
      >
        <Field label="Base caption" hint="Every platform falls back to this unless it has its own.">
          <textarea
            value={post.text}
            onChange={(e) => blast.mutate(post.key, (p) => ({ ...p, text: e.target.value }))}
            rows={3}
            placeholder="The caption you'd post if you only wrote one."
            className="w-full rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink"
          />
        </Field>
        <Field label="Video hook" hint="Optional — the opening line, carried to PULSE.">
          <TextInput
            value={post.hookText}
            onChange={(v) => blast.mutate(post.key, (p) => ({ ...p, hookText: v }))}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowPresets(!showPresets)}>
            {showPresets ? "HIDE PRESETS" : "PRESETS"}
          </Button>
          {post.key === QUICK_KEY && <Button onClick={blast.reset}>RESET</Button>}
        </div>

        {post.patternFamily && (
          <p className="mt-3 font-mono text-[10px] tracking-[0.08em] text-faint">
            PATTERN · {post.patternFamily}
            {post.patternName && ` · ${post.patternName}`}
          </p>
        )}
      </Card>

      {showPresets && (
        <Card
          title="PRESETS"
          hint="A template per platform. {caption} is replaced with the caption. These survive Reset."
        >
          <ul className="space-y-3">
            {PLATFORMS.map((p) => (
              <li key={p.name}>
                <label
                  htmlFor={`preset-${p.name}`}
                  className="mb-1 block font-mono text-[10px] tracking-[0.08em] text-faint"
                >
                  {p.name.toUpperCase()}
                </label>
                <textarea
                  id={`preset-${p.name}`}
                  value={presets[p.name] ?? ""}
                  onChange={(e) => savePreset(p.name, e.target.value)}
                  rows={2}
                  placeholder="e.g. {caption}&#10;&#10;#hashtag #block"
                  className="w-full rounded-lg border border-edge bg-ground px-3 py-2 font-mono text-xs text-ink"
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SuggestPanel
        post={post}
        names={names}
        onApply={(suggestions) =>
          blast.mutate(post.key, (p) => ({
            ...p,
            suggestions: { ...p.suggestions, ...suggestions },
            // Seed each platform's caption with the top option, but never
            // overwrite one the creator already wrote.
            captions: Object.fromEntries(
              Object.entries({ ...p.captions }).concat(
                Object.entries(suggestions)
                  .filter(([n]) => !p.captions[n])
                  .map(([n, opts]) => [n, opts[0] ?? ""]),
              ),
            ),
          }))
        }
      />

      <Card
        title={`PLATFORMS — ${posted}/${names.length} POSTED`}
        hint="Switch off anywhere this clip was never going to."
      >
        <ul className="mb-4 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => {
            const on = names.includes(p.name);
            return (
              <li key={p.name}>
                <button
                  onClick={() => togglePlatform(p.name)}
                  aria-pressed={on}
                  className={`rounded-lg border px-2.5 py-1.5 text-sm transition ${
                    on ? "border-blast bg-surface2 text-ink" : "border-edge text-faint"
                  }`}
                >
                  <span aria-hidden className="mr-1.5">
                    {p.icon}
                  </span>
                  {p.name}
                </button>
              </li>
            );
          })}
        </ul>

        {names.length === 0 ? (
          <p className="text-sm text-muted">
            No platforms selected. Switch one on above and its caption appears here.
          </p>
        ) : (
          <ul className="space-y-3">
            {names.map((n) => {
              const platform = platformByName(n)!;
              return (
                <PlatformCard
                  key={n}
                  platform={platform}
                  post={post}
                  preset={presets[n]}
                  onCaption={(text) =>
                    blast.mutate(post.key, (p) => ({
                      ...p,
                      captions: { ...p.captions, [n]: text },
                    }))
                  }
                  onStatus={(next) =>
                    blast.setStatus(post.key, n, next, next === "skipped" || next === "posted")
                  }
                  onPosted={(url, caption) =>
                    blast.mutate(post.key, (p) => ({
                      ...p,
                      status: { ...p.status, [n]: "posted" },
                      postUrl: url ? { ...p.postUrl, [n]: url } : p.postUrl,
                      postedAt: { ...p.postedAt, [n]: Date.now() },
                      postedCaption: { ...p.postedCaption, [n]: caption },
                    }))
                  }
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="STATUS" hint="What PULSE will see when you import this session.">
        <ul className="space-y-1.5">
          {names.map((n) => (
            <li key={n} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink">{n}</span>
              <span className="font-mono text-[10px] tracking-[0.08em] text-muted">
                {STATUS_LABEL[post.status[n] ?? "none"].toUpperCase()}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

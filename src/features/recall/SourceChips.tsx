import { useState } from "react";
import { Button } from "../../components/ui";
import type { RecallLibrary } from "../../data/schemas/recall";

/**
 * The source tray. Each chip toggles whether its transcript is searched; the
 * count next to the title is how many moments it contributes.
 */
export function SourceChips({
  library,
  onToggle,
  onRename,
  onDelete,
  onAdd,
}: {
  library: RecallLibrary;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const startRename = (id: string, current: string): void => {
    setConfirming(null);
    setRenaming(id);
    setDraft(current);
  };

  const commitRename = (id: string): void => {
    onRename(id, draft);
    setRenaming(null);
  };

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-mono text-[10px] tracking-[0.14em] text-faint">
          SOURCES {library.enabled.length}/{library.sources.length}
        </h2>
        <Button onClick={onAdd}>+ ADD SOURCE</Button>
      </div>

      {library.sources.length === 0 ? (
        <p className="text-sm text-muted">
          No sources yet. Add a transcript and every line in it becomes searchable.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {library.sources.map((s) => {
            const on = library.enabled.indexOf(s.id) >= 0;
            if (renaming === s.id) {
              return (
                <li key={s.id} className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(s.id);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    aria-label={`Rename ${s.title}`}
                    className="rounded-lg border border-recall bg-ground px-2.5 py-1.5 text-sm text-ink"
                  />
                  <Button onClick={() => commitRename(s.id)}>SAVE</Button>
                  <Button onClick={() => setRenaming(null)}>CANCEL</Button>
                </li>
              );
            }
            return (
              <li
                key={s.id}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition ${
                  on ? "border-recall bg-surface2" : "border-edge"
                }`}
              >
                <button
                  onClick={() => onToggle(s.id)}
                  aria-pressed={on}
                  className="flex items-center gap-2 text-sm"
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 rounded-full ${on ? "bg-recall" : "bg-edge"}`}
                  />
                  <span className={on ? "text-ink" : "text-muted"}>{s.title}</span>
                  <span className="font-mono text-[10px] text-faint">{s.segments.length}</span>
                </button>
                <button
                  onClick={() => startRename(s.id, s.title)}
                  aria-label={`Rename ${s.title}`}
                  className="text-faint transition hover:text-ink"
                >
                  ✎
                </button>
                {confirming === s.id ? (
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setConfirming(null);
                        onDelete(s.id);
                      }}
                      className="font-mono text-[10px] text-gold"
                    >
                      REMOVE?
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      aria-label="Keep source"
                      className="text-faint"
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirming(s.id)}
                    aria-label={`Remove ${s.title}`}
                    className="text-faint transition hover:text-gold"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

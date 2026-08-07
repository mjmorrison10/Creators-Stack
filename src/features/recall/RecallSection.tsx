import { useMemo, useRef, useState } from "react";
import { SectionHeader } from "../../components/SectionHeader";
import { Button, Card, StatusLine } from "../../components/ui";
import { SECTIONS } from "../../sections";
import { downloadJson } from "../../data/download";
import {
  binHas,
  buildLibraryExport,
  libraryFilename,
  LibraryImportError,
  parseLibraryFile,
  search,
  summarizeImport,
  terms as splitTerms,
  type ImportMode,
} from "../../domain/recall/library";
import { useRecall } from "./useRecall";
import { SourceChips } from "./SourceChips";
import { SearchResults } from "./SearchResults";
import { BinPanel } from "./BinPanel";
import { AddSourceModal } from "./AddSourceModal";
import type { RecallLibraryExport } from "../../data/schemas/recall";

const meta = SECTIONS[0]!;

type Status = { tone: "ok" | "error"; text: string };

export function RecallSection() {
  const recall = useRecall();
  const { library } = recall;

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<RecallLibraryExport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const terms = useMemo(() => splitTerms(query.trim()), [query]);
  const result = useMemo(() => search(library, query), [library, query]);

  const readFile = (file: File | undefined): void => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = parseLibraryFile(JSON.parse(String(r.result)));
        const s = summarizeImport(data);
        setPending(data);
        setStatus({
          tone: "ok",
          text: `File looks valid: ${s.sources} sources · ${s.moments} moments · ${s.bin} bin items${
            s.exportedAt ? ` (exported ${s.exportedAt})` : ""
          }. Choose how to apply it.`,
        });
      } catch (e) {
        setPending(null);
        setStatus({
          tone: "error",
          text:
            e instanceof LibraryImportError
              ? `Import failed: ${e.message}`
              : "Import failed: that file isn't valid JSON.",
        });
      }
    };
    r.onerror = () => setStatus({ tone: "error", text: "Could not read that file." });
    r.readAsText(file);
  };

  const applyImport = async (mode: ImportMode): Promise<void> => {
    if (!pending) return;
    const r = await recall.importLibrary(pending, mode);
    setPending(null);
    setStatus({
      tone: "ok",
      text:
        mode === "replace"
          ? `Library replaced — ${r.added} sources loaded.`
          : `Merged: ${r.added} added, ${r.skipped} already in the library.`,
    });
  };

  if (recall.loading) {
    return (
      <>
        <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />
        <p className="text-sm text-muted">Opening your library…</p>
      </>
    );
  }

  return (
    <>
      <SectionHeader name={meta.name} tagline={meta.tagline} accent={meta.accent} />

      <SourceChips
        library={library}
        onToggle={(id) => void recall.toggle(id)}
        onRename={(id, name) => void recall.rename(id, name)}
        onDelete={(id) => void recall.deleteSource(id)}
        onAdd={() => setAdding(true)}
      />

      <div className="mb-3">
        <label htmlFor="recall-q" className="sr-only">
          Search every transcript
        </label>
        <input
          id="recall-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every moment you've ever recorded…"
          className="w-full rounded-lg border border-edge bg-ground px-3 py-2.5 text-sm text-ink"
        />
        <p className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-faint">
          {terms.length ? (
            <>
              <b className="text-ink">{result.hits.length}</b>{" "}
              {result.hits.length === 1 ? "MOMENT" : "MOMENTS"} · {result.matchedSources} OF{" "}
              {result.enabledSources} SOURCES
            </>
          ) : (
            <>
              <b className="text-ink">{result.totalMoments}</b> MOMENTS INDEXED ·{" "}
              {library.sources.length} SOURCES
            </>
          )}
        </p>
      </div>

      <div className="mb-6">
        <SearchResults
          result={result}
          query={query}
          terms={terms}
          hasSources={library.sources.length > 0}
          isInBin={(key) => binHas(library, key)}
          onToggleClip={(srcId, idx) => void recall.toggleClip(srcId, idx)}
          onTry={setQuery}
        />
      </div>

      <BinPanel
        library={library}
        onRemove={(_srcId, key) => void recall.removeClip(key)}
        onClear={() => void recall.emptyBin()}
      />

      <Card title="LIBRARY FILE" hint="A portable copy of every source, bin item and toggle.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => downloadJson(buildLibraryExport(library), libraryFilename())}>
            EXPORT LIBRARY
          </Button>
          <Button onClick={() => fileInput.current?.click()}>IMPORT LIBRARY</Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              readFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        {pending && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void applyImport("merge")} variant="primary">
              MERGE — ADD NEW SOURCES ONLY
            </Button>
            <Button onClick={() => void applyImport("replace")}>REPLACE EVERYTHING</Button>
            <Button onClick={() => setPending(null)}>CANCEL</Button>
          </div>
        )}

        {status && <StatusLine tone={status.tone}>{status.text}</StatusLine>}
      </Card>

      {adding && (
        <AddSourceModal
          onClose={() => setAdding(false)}
          onAdd={async (title, raw) => {
            const s = await recall.addFromTranscript(title, raw);
            if (!s) throw new Error("No timecoded moments found in that transcript.");
            setStatus({ tone: "ok", text: `Added “${s.title}” — ${s.segments.length} moments.` });
          }}
        />
      )}
    </>
  );
}

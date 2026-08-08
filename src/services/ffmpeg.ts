/**
 * ffmpeg.wasm loader — ported from blast/app.js lines 2005-2070.
 *
 * The library is vendored under public/vendor rather than pulled from a CDN
 * because ffmpeg.wasm spawns a Worker, and cross-origin workers are blocked.
 * Serving it from our own origin is what makes it work at all.
 *
 * Everything here loads lazily: the wasm core is ~31MB, so it must never be on
 * the critical path. Nothing imports this module until the crop tool opens.
 */

/** Centre-crop to 9:16 and scale to 1080×1920 — the vertical-video format. */
export const CROP_FILTER = "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920";

export interface FFmpegInstance {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (name: string, data: Uint8Array) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array>;
  exec: (args: string[]) => Promise<number>;
  on: (event: string, cb: (e: { progress?: number; message?: string }) => void) => void;
  terminate: () => void;
}

let instance: FFmpegInstance | null = null;
let loading: Promise<FFmpegInstance> | null = null;

/**
 * ffmpeg's `progress` listener can only be attached once per instance, but the
 * instance outlives any single panel. The handler is held in a mutable slot so
 * a remounted panel gets the events instead of the first caller keeping them.
 */
let progressHandler: ((ratio: number) => void) | null = null;

function vendorUrl(path: string): string {
  // BASE_URL, not a root-absolute path — this app is served from a subpath.
  return new URL(`vendor/${path}`, new URL(import.meta.env.BASE_URL, location.href)).href;
}

/**
 * Load ffmpeg once and reuse it. Concurrent callers share the same promise
 * rather than each paying the multi-megabyte fetch.
 */
export async function loadFFmpeg(
  onProgress?: (ratio: number) => void,
): Promise<FFmpegInstance> {
  progressHandler = onProgress ?? null;
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    const util = (await import(/* @vite-ignore */ vendorUrl("ffmpeg-util/index.js"))) as {
      toBlobURL: (url: string, mime: string) => Promise<string>;
    };
    const { FFmpeg } = (await import(/* @vite-ignore */ vendorUrl("ffmpeg/index.js"))) as {
      FFmpeg: new () => FFmpegInstance;
    };

    const ff = new FFmpeg();
    ff.on("progress", (e) => progressHandler?.(e.progress ?? 0));

    // The core is fetched as a blob URL so the worker can import it same-origin.
    const base = vendorUrl("ffmpeg-core");
    await ff.load({
      coreURL: await util.toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await util.toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });

    instance = ff;
    return ff;
  })();

  try {
    return await loading;
  } catch (err) {
    // Let a later attempt retry rather than caching the failure forever.
    loading = null;
    throw err;
  }
}

/** What ffmpeg writes the result to. Matches the legacy name. */
export const CROP_OUTPUT = "output.mp4";

/**
 * The input filename ffmpeg is handed, keeping the source's real extension.
 *
 * ffmpeg will usually sniff the container regardless, but the legacy code
 * passes the real extension and a demuxer that falls back on the name is a
 * bug that would only show up on somebody's actual footage.
 */
export function cropInputName(filename: string): string {
  return "input" + (filename.match(/\.\w+$/) || [".mp4"])[0];
}

/**
 * The exec argument vector, verbatim from blast/app.js.
 *
 * `-preset ultrafast` is not a quality shrug — this is wasm running in a
 * browser tab, and a slower preset turns a long clip into a wait nobody sits
 * through. `+faststart` is the one deliberate addition: it moves the moov
 * atom to the front so the preview `<video>` can play before the whole blob
 * is buffered.
 */
export function cropArgs(inName: string, outName: string = CROP_OUTPUT): string[] {
  return [
    "-i", inName,
    "-vf", CROP_FILTER,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outName,
  ];
}

/**
 * The crop itself, against an already-loaded engine.
 *
 * Split from `cropTo916` so the write/exec/read sequence can be exercised
 * without a 31MB wasm fetch — the filenames on either side of `exec` have to
 * agree, and that is exactly the kind of mismatch that only shows up at
 * runtime.
 */
export async function cropWith(ff: FFmpegInstance, file: File): Promise<Uint8Array> {
  const inName = cropInputName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await ff.writeFile(inName, bytes);
  await ff.exec(cropArgs(inName));
  return ff.readFile(CROP_OUTPUT);
}

/** Centre-crop a video to 9:16. Returns the encoded MP4 bytes. */
export async function cropTo916(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  return cropWith(await loadFFmpeg(onProgress), file);
}

/** The filename the legacy download button produced. */
export function croppedFilename(sourceName: string): string {
  return "blast-" + sourceName.replace(/\.\w+$/, "") + "-vertical.mp4";
}

/** Free the worker and its memory — the core holds a lot of it. */
export function releaseFFmpeg(): void {
  instance?.terminate();
  instance = null;
  loading = null;
  progressHandler = null;
}

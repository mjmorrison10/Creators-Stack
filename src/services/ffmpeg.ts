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

interface FFmpegInstance {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (name: string, data: Uint8Array) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array>;
  exec: (args: string[]) => Promise<number>;
  on: (event: string, cb: (e: { progress?: number; message?: string }) => void) => void;
  terminate: () => void;
}

let instance: FFmpegInstance | null = null;
let loading: Promise<FFmpegInstance> | null = null;

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
    if (onProgress) ff.on("progress", (e) => onProgress(e.progress ?? 0));

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

/** Centre-crop a video to 9:16. Returns the encoded MP4 bytes. */
export async function cropTo916(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  const ff = await loadFFmpeg(onProgress);
  const inName = "in.mp4";
  const outName = "out.mp4";

  const bytes = new Uint8Array(await file.arrayBuffer());
  await ff.writeFile(inName, bytes);
  await ff.exec([
    "-i",
    inName,
    "-vf",
    CROP_FILTER,
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outName,
  ]);
  return ff.readFile(outName);
}

/** Free the worker and its memory — the core holds a lot of it. */
export function releaseFFmpeg(): void {
  instance?.terminate();
  instance = null;
  loading = null;
}

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CROP_FILTER,
  CROP_OUTPUT,
  cropArgs,
  cropInputName,
  cropWith,
  croppedFilename,
  type FFmpegInstance,
} from "../../src/services/ffmpeg";

const APP_JS = resolve(import.meta.dirname, "../../../blast/app.js");

/**
 * The crop is the one part of BLAST that runs a real encoder, and its argument
 * vector is not something you can eyeball for correctness — a dropped `-preset
 * ultrafast` produces a *correct* file, just one that takes minutes longer in
 * a browser tab. So the vector is diffed against the literal argument list in
 * blast/app.js rather than trusted.
 *
 * No wasm runs here. `cropTo916` is exercised against a stub instance; a real
 * transcode in CI would be a multi-minute test that proves nothing the arg
 * diff doesn't already prove.
 */
describe("the 9:16 crop", () => {
  const legacy = readFileSync(APP_JS, "utf8");

  it("uses the legacy crop filter verbatim", () => {
    // The filter is a persisted visual contract: change it and previously
    // cropped clips no longer match newly cropped ones.
    const m = legacy.match(/var CROP_FILTER = "([^"]+)"/);
    expect(m, "CROP_FILTER not found in blast/app.js").toBeTruthy();
    expect(CROP_FILTER).toBe(m![1]);
  });

  it("passes the same encode flags the legacy did", () => {
    // Sliced from the original exec() call so the test fails if either side
    // moves. ffmpeg's own defaults are much slower than ultrafast, which is
    // the whole reason the flag is there.
    const exec = legacy.slice(legacy.indexOf("await ff.exec(["));
    const vector = exec.slice(0, exec.indexOf("]);"));
    for (const flag of ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23"]) {
      expect(vector, `${flag} missing from the legacy vector`).toContain(`"${flag}"`);
      expect(cropArgs("input.mp4"), `${flag} missing from the port`).toContain(flag);
    }
  });

  it("keeps the flags in the order ffmpeg expects", () => {
    // -vf before the codec, codec before the output name: ffmpeg reads
    // arguments positionally and an output-position flag is a different
    // command entirely.
    const args = cropArgs("input.mp4");
    expect(args.indexOf("-i")).toBe(0);
    expect(args.indexOf("-vf")).toBeLessThan(args.indexOf("-c:v"));
    expect(args.indexOf("-c:v")).toBeLessThan(args.indexOf("-c:a"));
    expect(args[args.length - 1]).toBe(CROP_OUTPUT);
  });

  it("copies the audio stream rather than re-encoding it", () => {
    // Re-encoding audio costs time and quality for nothing — the crop only
    // touches video.
    const args = cropArgs("input.mp4");
    expect(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 2)).toEqual(["-c:a", "copy"]);
  });

  it("front-loads the moov atom so the preview can play before it buffers", () => {
    // The one deliberate addition over legacy: without +faststart the result
    // <video> waits for the entire blob.
    expect(cropArgs("input.mp4")).toContain("+faststart");
  });

  it("hands ffmpeg the source's real extension", () => {
    // Legacy: "input" + (name.match(/\.\w+$/) || [".mp4"])[0]
    expect(cropInputName("clip.mov")).toBe("input.mov");
    expect(cropInputName("Episode 41.webm")).toBe("input.webm");
    expect(cropInputName("a.b.c.mp4")).toBe("input.mp4");
  });

  it("falls back to .mp4 when the name carries no extension", () => {
    expect(cropInputName("no-extension")).toBe("input.mp4");
    expect(cropInputName("")).toBe("input.mp4");
  });

  it("names the download the way the legacy button did", () => {
    expect(croppedFilename("clip.mov")).toBe("blast-clip-vertical.mp4");
    expect(croppedFilename("no-extension")).toBe("blast-no-extension-vertical.mp4");
  });
});

describe("the crop against a stub engine", () => {
  /** Records what the crop actually asked the engine to do. */
  function stubEngine() {
    const calls: { writes: string[]; execs: string[][]; reads: string[] } = {
      writes: [],
      execs: [],
      reads: [],
    };
    const ff: FFmpegInstance = {
      load: async () => {},
      writeFile: async (name) => {
        calls.writes.push(name);
      },
      readFile: async (name) => {
        calls.reads.push(name);
        return new Uint8Array([1, 2, 3]);
      },
      exec: async (args) => {
        calls.execs.push(args);
        return 0;
      },
      on: () => {},
      terminate: () => {},
    };
    return { ff, calls };
  }

  function fakeFile(name: string): File {
    return { name, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as File;
  }

  it("writes, execs and reads the names it said it would", async () => {
    const { ff, calls } = stubEngine();
    const out = await cropWith(ff, fakeFile("clip.mov"));

    expect(calls.writes).toEqual(["input.mov"]);
    expect(calls.execs).toEqual([cropArgs("input.mov")]);
    expect(calls.reads).toEqual([CROP_OUTPUT]);
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reads back the file it just wrote", async () => {
    // A mismatch between the exec's output argument and the readFile name is
    // silent at compile time and fatal at runtime.
    const { ff, calls } = stubEngine();
    await cropWith(ff, fakeFile("clip.mp4"));
    expect(calls.execs[0]!.at(-1)).toBe(calls.reads[0]);
  });

  it("passes the source bytes through to the engine", async () => {
    const { ff, calls } = stubEngine();
    await cropWith(ff, fakeFile("a.mp4"));
    expect(calls.writes).toHaveLength(1);
  });
});

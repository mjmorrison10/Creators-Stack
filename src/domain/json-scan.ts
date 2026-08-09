/**
 * String- and escape-aware scanning over a JSON-ish string.
 *
 * These exist because a model's reply can be cut off mid-generation, and the
 * useful response to that is to keep the items that DID arrive rather than
 * discard a mostly-good answer. Doing that safely means walking the text with
 * an awareness of string boundaries — a `{` or `,` inside a caption must not
 * be mistaken for structure.
 *
 * Extracted from BLAST's caption salvage so HOOKLAB's reply salvage doesn't
 * carry a second copy of the same fiddly loop. The two callers salvage
 * different shapes (BLAST: top-level key/value pairs; HOOKLAB: complete
 * objects inside an array), which is why only the scanners are shared.
 */

/** End index just past the string starting at `j`, or -1 if it never closes. */
export function scanString(t: string, j: number): number {
  if (t[j] !== '"') return -1;
  j++;
  while (j < t.length) {
    const c = t[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === '"') return j + 1;
    j++;
  }
  return -1;
}

/**
 * End index just past a balanced value starting at `i`, or -1 if it never
 * closes. A bare scalar ends at the first top-level `,` or `}`.
 */
export function scanValue(t: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < t.length) {
    const c = t[j];
    if (c === '"') {
      const end = scanString(t, j);
      if (end < 0) return -1;
      j = end;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return j + 1;
      if (depth < 0) return -1;
    } else if (depth === 0 && (c === "," || c === "}")) return j;
    j++;
  }
  return -1;
}

/**
 * Every COMPLETE object inside the array at `"<key>": [ … ]`, even when the
 * array itself was never closed.
 *
 * Each element is parsed on its own, so a half-written final object is
 * dropped rather than guessed at. Returns an empty array when the key is
 * absent or nothing survives — the caller decides whether that is a failure.
 */
export function salvageArrayItems(text: string, key: string): unknown[] {
  const t = String(text ?? "");
  const at = t.indexOf(`"${key}"`);
  if (at < 0) return [];

  let i = at + key.length + 2;
  while (i < t.length && /\s/.test(t[i]!)) i++;
  if (t[i] !== ":") return [];
  i++;
  while (i < t.length && /\s/.test(t[i]!)) i++;
  if (t[i] !== "[") return [];
  i++;

  const out: unknown[] = [];
  while (i < t.length) {
    while (i < t.length && /[\s,]/.test(t[i]!)) i++;
    if (t[i] !== "{") break;
    const end = scanValue(t, i);
    if (end < 0) break; // the last element was cut off mid-write
    try {
      out.push(JSON.parse(t.slice(i, end)));
    } catch {
      break;
    }
    i = end;
  }
  return out;
}

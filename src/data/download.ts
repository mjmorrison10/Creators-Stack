/**
 * Single download path for every export in the app.
 *
 * Previously each section had its own copy of the Blob/objectURL/anchor dance,
 * which meant a fix to one (revoke timing, filename handling) silently missed
 * the others.
 */
export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click has been dispatched, or the download can be
  // cancelled before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Today as YYYY-MM-DD, the suffix the legacy backup filenames use. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Copy text, falling back to a hidden textarea where the async Clipboard API
 * is unavailable — it needs a secure context, so plain http silently has no
 * `navigator.clipboard` at all. Returns whether it worked so callers can say so.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or non-secure context — fall through to the fallback.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

import { useEffect, useState } from "react";

/**
 * The app's announcement channel for assistive tech.
 *
 * Why this exists rather than `role="status"` on each message: a live region
 * only announces changes to a region that was ALREADY in the accessibility
 * tree. Every status line in this app renders together with its text — the
 * node and the message arrive in the same commit — so screen readers treat it
 * as ordinary new content and say nothing. The result was an app that
 * confirmed "Queued 1 clip", "Logged.", "Imported 3 posts" entirely in
 * pixels.
 *
 * These two regions mount at boot and stay empty until something is said.
 *
 * Polite vs assertive is a real distinction, not a formality: polite waits
 * for a pause, which is right for "Logged." while the creator keeps typing.
 * Assertive interrupts, which is only justified when the thing they are
 * doing has failed and continuing would waste their time.
 */
type Tone = "polite" | "assertive";

let politeText = "";
let assertiveText = "";
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function announce(text: string, tone: Tone = "polite"): void {
  const clean = text.trim();
  if (!clean) return;
  if (tone === "assertive") assertiveText = clean;
  else politeText = clean;
  emit();
}

/**
 * Mount once, near the root. Renders nothing visible.
 *
 * The key on the inner node is deliberate: re-announcing the SAME string
 * (two identical failures in a row, say) is a no-op for most screen readers
 * because the region's text never changed. Remounting the child forces the
 * change they listen for.
 */
export function LiveRegion() {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = (): void => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {politeText}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertiveText}
      </div>
    </>
  );
}

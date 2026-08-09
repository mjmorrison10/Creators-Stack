import type { PulsePost } from "../../data/schemas/pulse";

const W = 120;
const H = 34;
const PAD = 2;

/**
 * The view curve, ported from pulse/app.js:822.
 *
 * Plotted against ELAPSED time rather than reading index, so two readings an
 * hour apart and two a week apart don't look alike — the shape is the point.
 * Under two readings there is no shape to draw, so nothing renders rather than
 * a flat line implying a measurement that was never taken.
 *
 * Decorative: the numbers next to it are the accessible version, so it is
 * hidden from assistive tech rather than given a label that repeats them.
 */
export function Sparkline({ post }: { post: PulsePost }) {
  const s = post.snapshots || [];
  if (s.length < 2) return null;

  const xs = s.map((p) => p.elapsedMin);
  const ys = s.map((p) => p.views);
  const minx = Math.min(...xs);
  const maxx = Math.max(...xs);
  const miny = Math.min(...ys);
  const maxy = Math.max(...ys);

  // Degenerate axes collapse to a constant rather than dividing by zero.
  const sx = (x: number): number =>
    maxx === minx ? PAD : PAD + ((x - minx) / (maxx - minx)) * (W - 2 * PAD);
  const sy = (y: number): number =>
    maxy === miny ? H / 2 : H - PAD - ((y - miny) / (maxy - miny)) * (H - 2 * PAD);

  const d = s
    .map((p, i) => `${i ? "L" : "M"}${sx(p.elapsedMin).toFixed(1)} ${sy(p.views).toFixed(1)}`)
    .join(" ");
  const last = s[s.length - 1]!;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="shrink-0">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
        className="text-pulse"
      />
      <circle
        cx={sx(last.elapsedMin)}
        cy={sy(last.views)}
        r={2.4}
        fill="currentColor"
        className="text-pulse"
      />
    </svg>
  );
}

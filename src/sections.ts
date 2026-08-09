/**
 * The four legacy apps become four sections of one app. This registry is the
 * single source of truth for nav order, routes, and accent colors — the colors
 * match stacknav.js so the unified app reads as the same product line.
 */
export type SectionKey = "recall" | "hooklab" | "blast" | "pulse";

export interface Section {
  key: SectionKey;
  name: string;
  path: string;
  tagline: string;
  /** Tailwind text-color utility backed by the token in index.css. */
  accent: string;
}

export const SECTIONS: readonly Section[] = [
  {
    key: "recall",
    name: "RECALL",
    path: "/recall",
    tagline: "Clip memory — every transcript, searchable.",
    accent: "text-recall",
  },
  {
    key: "hooklab",
    name: "HOOKLAB",
    path: "/hooklab",
    tagline: "Underwrite hooks against your own ledger.",
    accent: "text-hooklab",
  },
  {
    key: "blast",
    name: "BLAST",
    path: "/blast",
    tagline: "Cut once, post everywhere.",
    accent: "text-blast",
  },
  {
    key: "pulse",
    name: "PULSE",
    path: "/pulse",
    tagline: "Track what happened after you posted.",
    accent: "text-pulse",
  },
] as const;

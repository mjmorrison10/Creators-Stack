/**
 * Deterministic slot fill for the no-AI path — ported from Hooklabs/app.js.
 *
 * The point of HOOKLAB is that the structure carries the value: even with no
 * API key, a scaffold filled with plausible defaults is a usable starting line
 * and shows what the pattern is asking for. The fills are opinionated on
 * purpose — they demonstrate the shape rather than pretending to be finished
 * copy.
 */

const MAX_TOPIC_LEN = 80;

/** slot name → default text. Copied verbatim from the legacy replace chain. */
export const SLOT_FILLS: Record<string, string> = {
  bad_habit: "guessing your hooks",
  better: "underwriting them from proof",
  mistake: "posting without logging outcomes",
  n: "3",
  pain: "editing time",
  industry: "creator",
  goal: "want real growth",
  before: "random AI hooks",
  after: "a ledger that ranks by proof",
  audience: "creators",
  old_way: "wing every open",
  turning_point: "started tracking winners",
  cost: "weeks of dead posts",
  things: "hook structures",
  action: "write an open",
  timeframe: "30 days",
  start: "guesswork",
  end: "a personal hook system",
  product_type: "another AI writer",
  problem: "weak retention",
  identity: "creator",
  win: "stops the scroll on purpose",
  event: "posting session",
  myth: "AI hooks are enough",
  reality: "proof is the product",
  process: "a clip actually goes viral",
  domain: "short-form",
  a: "proof",
  b: "vibes",
  duration: "30 days",
  insult: "lazy",
  system_problem: "hook system problem",
  vague: "a discipline issue",
  named_diagnosis: "hook rot",
  named_problem: "silent content disease",
  odd_n: "7",
  fantasy: "go viral overnight",
  real_outcome: "stop guessing your opens",
  expert_type: "guru",
  advice: "post more",
  time_a: "year one",
  time_b: "year three",
  low: "was guessing",
  high: "had a ledger",
  gatekeepers: "course sellers",
  minutes: "5",
  enemy_system: "the template industrial complex",
  receipt_type: "retention graph",
  narrow_identity: "podcast clippers",
  asset: "hook checklist",
  use_case: "your next short",
  role: "creator",
  counterintuitive_step: "log dead posts on purpose",
  metric: "3s retention",
  trap: "start with context",
  trend: "AI captions",
  visual_shock: "show the dead retention graph",
  option_a: "proof",
  option_b: "vibes",
  stack_type: "hook underwriting",
  tool: "caption",
  text: "STOP scrolling",
  deadline: "Friday",
  consequence: "another week of dead opens",
  subject: "one creator",
  result: "2x retention",
  agitation: "the algorithm learning to bury you",
  mechanism_name: "proof-ranked opens",
  specific_reason: "your ledger shows winners share one structure",
  objection: "AI hooks are fine",
  bridge: "logging outcomes",
  ultra_specific_person: "short-form creator tired of guessing",
  odd_fact: "logging losers",
  sacrifice: "posting 5x a day",
  quote: "I finally stopped guessing",
  person: "a client",
  reframe: "your weak open is a systems problem",
  desirable_outcome: "write hooks that hold",
  common_pain: "sounding like ChatGPT",
  small_mistake: "skip the ledger",
  worse: "repeat dead patterns",
  catastrophe: "burn the niche",
  jargon: "3-second retention",
  challenge: "logging every open",
  blunt_truth: "your hook is forgettable",
  setting: "2am after another dead post",
  insight: "structures beat vibes",
  development: "proof-based underwriting",
  enemy: "the course industry",
  payoff: "the structure behind winners",
  tiny_change: "one logged outcome",
  big_effort: "another 20 AI rewrites",
  small_niche: "tight niche",
  high_intent: "high intent",
  big_audience: "empty reach",
  done_thing: "building this for 3 years",
  common_advice: "post more",
  starting_point: "day one",
  shock_stat: "90% of hooks die in the first second",
  setback: "a dead launch",
  confession: "most of my winners were logged, not guessed",
  category: "creator habit",
  // The legacy chain assigns {stack_type} twice — "hook underwriting" (kept,
  // above) and "creator ops". Because each .replace is global, the first call
  // consumes every occurrence and the second never fires, so it was already
  // dead code. Only the effective value is carried over.
};

/** Slots that take the user's own topic rather than a canned default. */
export const TOPIC_SLOTS = ["topic", "thing", "claim", "line"] as const;

export function offlineFill(scaffold: string, topic?: string): string {
  const t = (topic || "this").trim();
  const short = t.length > MAX_TOPIC_LEN ? `${t.slice(0, MAX_TOPIC_LEN - 3)}…` : t;

  let text = scaffold;
  for (const slot of TOPIC_SLOTS) {
    text = text.replace(new RegExp(`\\{${slot}\\}`, "g"), short);
  }
  for (const [slot, fill] of Object.entries(SLOT_FILLS)) {
    text = text.replace(new RegExp(`\\{${slot}\\}`, "g"), fill);
  }
  return text;
}

/** Any slot the fill table doesn't know about, so gaps are visible not silent. */
export function unfilledSlots(text: string): string[] {
  return [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!);
}

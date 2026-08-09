/* eslint-disable */
/**
 * The hook pattern bank — data ported VERBATIM from Hooklabs/patterns.js.
 *
 * HOOKLAB underwrites from structures, not freeform AI vibes: the durable unit
 * is mechanism + scaffold, and AI only fills slots. Changing a scaffold or a
 * strength silently changes what the app recommends, so this file is a copy,
 * not a rewrite — `tests/unit/patterns-golden.test.ts` imports the original
 * module and asserts deep equality entry by entry.
 *
 * Tiers:
 *   core       — always-on daily drivers (shown first)
 *   extended   — depth / niche / rare weapons (See more)
 *   historical — classic attention physics with documented lineage
 *
 * HISTORICAL_INSTANCES are evidence, not extra candidates.
 *
 * Types live in ./patterns.ts, which re-exports this data typed.
 */

export const MECHANISMS = [
  { id: "curiosity", name: "Curiosity / open loop", job: "Force investigate / WTF closure" },
  { id: "contrarian", name: "Contrarian / status challenge", job: "Break expected belief" },
  { id: "diagnosis", name: "Fear / diagnosis / unnamed problem", job: "Name a vague pain so it feels real" },
  { id: "proof", name: "Proof / specificity", job: "Make claims believable with concrete stakes" },
  { id: "story", name: "Story / identity", job: "Self-selection + emotional arc" },
  { id: "value", name: "Value / list / utility", job: "Clear payoff, scannable promise" },
  { id: "engagement", name: "Engagement engineering", job: "Manufacture comments, saves, stitches" },
  { id: "interrupt", name: "Pattern interrupt", job: "Break feed autopilot in <1s" },
  { id: "authority", name: "Authority / behind curtain", job: "Process transparency builds trust" },
  { id: "warning", name: "Warning / protective framing", job: "Urgency without pure hype" },
  { id: "identity", name: "Identity / POV", job: "Viewer recognizes themselves" },
  { id: "mistake", name: "Mistake / cost of wrong", job: "Loss aversion + correction" },
  { id: "thread", name: "Thread / serialized text", job: "Promise a multi-post payoff worth the tap-through" }
];

function P(o: any): any {
  // defaults
  return Object.assign({
    tier: "core",
    mechanism: o.family || "curiosity",
    evidence: "market-observed",
    era: "modern",
    platforms: ["tiktok", "reels", "shorts"],
    mediums: ["video", "text"],
    spoken: true,
    textOnScreen: true,
    niches: ["general"],
    strength: 0.8,
    slots: [],
    relatedCore: []
  }, o);
}

export const PATTERNS = [
  // ========== CORE (daily drivers) ==========
  P({ id: "curiosity-gap", name: "Curiosity Gap", family: "curiosity", mechanism: "curiosity", tier: "core",
    scaffold: "Nobody talks about the real reason {topic}.", slots: ["topic"],
    why: "Opens a loop the viewer has to close — classic WTF-investigate reflex",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.86,
    evidence: "market-observed", relatedCore: ["industry-secret", "name-unnamed-fear"] }),

  P({ id: "contrarian-stop", name: "Contrarian Stop", family: "contrarian", mechanism: "contrarian", tier: "core",
    scaffold: "Stop {bad_habit}. Do {better} instead.", slots: ["bad_habit", "better"],
    why: "Pattern interrupt + clear alternative",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.88,
    platforms: ["tiktok", "reels", "shorts", "linkedin"] }),

  P({ id: "specific-proof", name: "Specific Proof", family: "proof", mechanism: "proof", tier: "core",
    scaffold: "I tested {thing} for {duration}. Here's what broke.", slots: ["thing", "duration"],
    why: "Specificity + stakes beats generic claims",
    niches: ["business", "creators", "fitness", "finance", "tech", "general"], strength: 0.9,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"] }),

  P({ id: "mistake-callout", name: "Mistake Callout", family: "mistake", mechanism: "mistake", tier: "core",
    scaffold: "If you're still {mistake}, this is why it fails.", slots: ["mistake"],
    why: "Identity threat + promised fix",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.87,
    platforms: ["tiktok", "reels", "shorts", "linkedin"] }),

  P({ id: "numbered-value", name: "Numbered Value", family: "value", mechanism: "value", tier: "core",
    scaffold: "{n} rules that cut my {pain} in half.", slots: ["n", "pain"],
    why: "Clear promise, scannable payoff",
    niches: ["business", "creators", "fitness", "finance", "tech", "general"], strength: 0.84,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin", "x"] }),

  P({ id: "mid-action", name: "Mid-Action Open", family: "interrupt", mechanism: "interrupt", tier: "core",
    scaffold: "—and that's the moment everything flipped.", slots: [],
    why: "Starts on the payoff, not the setup",
    niches: ["story", "creators", "business", "general"], strength: 0.82, textOnScreen: false, mediums: ["video"] }),

  P({ id: "industry-secret", name: "Industry Secret", family: "curiosity", mechanism: "curiosity", tier: "core",
    scaffold: "The {industry} industry doesn't want you to know this.", slots: ["industry"],
    why: "Us-vs-them + forbidden knowledge",
    niches: ["business", "fitness", "finance", "tech", "general"], strength: 0.85,
    platforms: ["tiktok", "reels", "shorts", "youtube"] }),

  P({ id: "warning-psa", name: "Warning / PSA", family: "warning", mechanism: "warning", tier: "core",
    scaffold: "Stop using {thing} immediately if you {goal}.", slots: ["thing", "goal"],
    why: "Urgency + protective framing",
    niches: ["fitness", "finance", "tech", "creators", "general"], strength: 0.83 }),

  P({ id: "before-after", name: "Before / After", family: "proof", mechanism: "proof", tier: "core",
    scaffold: "Before: {before}. After: {after}. Here's the only change.", slots: ["before", "after"],
    why: "Transformation is a native short-form language",
    niches: ["fitness", "business", "creators", "finance", "general"], strength: 0.86,
    platforms: ["tiktok", "reels", "shorts", "youtube"] }),

  P({ id: "hot-take", name: "Hot Take", family: "contrarian", mechanism: "contrarian", tier: "core",
    scaffold: "Unpopular opinion: {claim}.", slots: ["claim"],
    why: "Polarization drives comments",
    niches: ["business", "creators", "finance", "general"], strength: 0.8,
    platforms: ["tiktok", "reels", "shorts", "x", "linkedin"] }),

  P({ id: "question-bait", name: "Question Bait", family: "engagement", mechanism: "engagement", tier: "core",
    scaffold: "Why do most {audience} still {pain}?", slots: ["audience", "pain"],
    why: "Pulls the viewer into answering",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.79,
    platforms: ["tiktok", "reels", "shorts", "linkedin", "x"] }),

  P({ id: "i-used-to", name: "I Used To", family: "story", mechanism: "story", tier: "core",
    scaffold: "I used to {old_way}. Then I {turning_point}.", slots: ["old_way", "turning_point"],
    why: "Personal arc creates trust fast",
    niches: ["story", "creators", "business", "fitness", "general"], strength: 0.84,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"], textOnScreen: false }),

  P({ id: "cost-of-wrong", name: "Cost of Wrong", family: "mistake", mechanism: "mistake", tier: "core",
    scaffold: "This one mistake cost me {cost}.", slots: ["cost"],
    why: "Loss aversion is sticky",
    niches: ["business", "finance", "creators", "general"], strength: 0.85,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"] }),

  P({ id: "list-tease", name: "List Tease", family: "value", mechanism: "value", tier: "core",
    scaffold: "Steal these {n} {things} I use every week.", slots: ["n", "things"],
    why: "Permission to copy + utility",
    niches: ["creators", "business", "tech", "general"], strength: 0.81,
    platforms: ["tiktok", "reels", "shorts", "linkedin"] }),

  P({ id: "most-creators-miss", name: "Most Creators Miss", family: "mistake", mechanism: "mistake", tier: "core",
    scaffold: "Most creators miss this when they {action}.", slots: ["action"],
    why: "In-group callout for creator niches",
    niches: ["creators", "business", "general"], strength: 0.86,
    platforms: ["tiktok", "reels", "shorts", "youtube"] }),

  P({ id: "time-boxed-result", name: "Time-Boxed Result", family: "proof", mechanism: "proof", tier: "core",
    scaffold: "In {timeframe} I went from {start} to {end}.", slots: ["timeframe", "start", "end"],
    why: "Bounded proof feels more believable",
    niches: ["business", "fitness", "finance", "creators", "general"], strength: 0.87,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"] }),

  P({ id: "dont-buy", name: "Don't Buy Until", family: "warning", mechanism: "warning", tier: "core",
    scaffold: "Don't buy {product_type} until you check this.", slots: ["product_type"],
    why: "Protective framing + product-adjacent utility",
    niches: ["finance", "tech", "fitness", "general"], strength: 0.8,
    platforms: ["tiktok", "reels", "shorts", "youtube"] }),

  P({ id: "one-change", name: "One Change", family: "value", mechanism: "value", tier: "core",
    scaffold: "One change fixed my {problem}.", slots: ["problem"],
    why: "Low cognitive load promise",
    niches: ["fitness", "creators", "business", "general"], strength: 0.83,
    platforms: ["tiktok", "reels", "shorts", "youtube"] }),

  P({ id: "pov-identity", name: "POV / Identity", family: "identity", mechanism: "identity", tier: "core",
    scaffold: "POV: you're a {identity} who finally {win}.", slots: ["identity", "win"],
    why: "Self-selection keeps the right people watching",
    niches: ["creators", "fitness", "business", "general"], strength: 0.78, spoken: false, mediums: ["video"] }),

  P({ id: "comment-trap", name: "Comment Trap", family: "engagement", mechanism: "engagement", tier: "core",
    scaffold: "Tell me I'm wrong: {claim}.", slots: ["claim"],
    why: "Manufactures replies on purpose",
    niches: ["business", "creators", "finance", "general"], strength: 0.77,
    platforms: ["tiktok", "reels", "shorts", "x", "linkedin"] }),

  P({ id: "silent-open", name: "Silent Pattern Interrupt", family: "interrupt", mechanism: "interrupt", tier: "core",
    scaffold: "[Silence / visual first] Then: {line}", slots: ["line"],
    why: "Unexpected quiet on noisy feeds holds attention",
    niches: ["creators", "story", "general"], strength: 0.76, mediums: ["video"] }),

  P({ id: "checklist-promise", name: "Checklist Promise", family: "value", mechanism: "value", tier: "core",
    scaffold: "Save this checklist before your next {event}.", slots: ["event"],
    why: "Save-bait + utility",
    niches: ["creators", "business", "tech", "general"], strength: 0.8,
    platforms: ["tiktok", "reels", "shorts", "linkedin"] }),

  P({ id: "myth-bust", name: "Myth Bust", family: "contrarian", mechanism: "contrarian", tier: "core",
    scaffold: "Myth: {myth}. Reality: {reality}.", slots: ["myth", "reality"],
    why: "Correction framing is highly rewatchable",
    niches: ["business", "fitness", "finance", "creators", "general"], strength: 0.85,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"] }),

  P({ id: "behind-curtain", name: "Behind the Curtain", family: "authority", mechanism: "authority", tier: "core",
    scaffold: "Here's what actually happens when {process}.", slots: ["process"],
    why: "Process transparency builds authority",
    niches: ["creators", "business", "tech", "general"], strength: 0.82,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"], textOnScreen: false }),

  P({ id: "started-over", name: "If I Started Over", family: "story", mechanism: "story", tier: "core",
    scaffold: "If I started over in {domain} today, I'd only do this.", slots: ["domain"],
    why: "Hindsight compression is highly valuable",
    niches: ["business", "creators", "finance", "tech", "general"], strength: 0.88,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"] }),

  // a few extra core
  P({ id: "do-this-not-that", name: "Do This, Not That", family: "contrarian", mechanism: "contrarian", tier: "core",
    scaffold: "Do this for {goal}. Not that.", slots: ["goal"],
    why: "Binary choice reduces cognitive load",
    niches: ["fitness", "creators", "business", "general"], strength: 0.84 }),

  P({ id: "the-real-reason", name: "The Real Reason", family: "curiosity", mechanism: "curiosity", tier: "core",
    scaffold: "The real reason your {thing} isn't working:", slots: ["thing"],
    why: "Promises a hidden cause — strong investigate loop",
    niches: ["creators", "business", "fitness", "finance", "general"], strength: 0.87 }),

  P({ id: "watch-till-end", name: "Payoff Delay (honest)", family: "curiosity", mechanism: "curiosity", tier: "core",
    scaffold: "I'm going to show you {payoff} — but only after this warning.", slots: ["payoff"],
    why: "Open loop with a protective frame; less cheap than 'wait for it'",
    niches: ["creators", "tech", "general"], strength: 0.74, evidence: "hypothesis" }),

  P({ id: "youre-not-lazy", name: "Reframe Identity", family: "identity", mechanism: "identity", tier: "core",
    scaffold: "You're not {insult}. You have a {system_problem}.", slots: ["insult", "system_problem"],
    why: "Relieves shame then redirects to a fixable system",
    niches: ["fitness", "creators", "business", "general"], strength: 0.86 }),

  P({ id: "name-unnamed-fear", name: "Name the Unnamed Fear", family: "diagnosis", mechanism: "diagnosis", tier: "core",
    scaffold: "It's not {vague}. It's {named_diagnosis}.", slots: ["vague", "named_diagnosis"],
    why: "Diagnosis marketing: name a vague pain so people must investigate if they have it (Listerine/halitosis lineage)",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.9,
    evidence: "historically-documented", era: "classic→modern",
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"],
    relatedCore: ["curiosity-gap", "mistake-callout", "industry-secret"] }),

  // ========== TEXT-NATIVE (written posts: X / Threads / LinkedIn) ==========
  P({ id: "thread-lessons", name: "Thread Opener: Earned Lessons", family: "thread", mechanism: "thread", tier: "core",
    scaffold: "{n} lessons from {done_thing} that most {audience} learn too late. A thread:", slots: ["n", "done_thing", "audience"],
    why: "Credential + numbered promise + explicit serial commitment — the opener underwrites a tap-through, not a 3-second hold",
    niches: ["business", "creators", "finance", "general"], strength: 0.86,
    platforms: ["x", "threads"], mediums: ["text"] }),

  P({ id: "how-i-thread", name: "Thread Opener: Exact Steps", family: "thread", mechanism: "thread", tier: "core",
    scaffold: "How I went from {start} to {end} in {timeframe} — the exact steps:", slots: ["start", "end", "timeframe"],
    why: "Bounded transformation + 'exact steps' kills the vague-guru objection before the first reply",
    niches: ["business", "creators", "finance", "fitness", "general"], strength: 0.87,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"] }),

  P({ id: "thread-mistakes", name: "Thread Opener: Expensive Mistakes", family: "thread", mechanism: "thread", tier: "extended",
    scaffold: "I spent {cost} learning {domain}. These {n} mistakes were 90% of it:", slots: ["cost", "domain", "n"],
    why: "Paid-tuition framing — the cost is the proof, the mistakes are the curriculum",
    niches: ["business", "finance", "creators", "general"], strength: 0.84,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"] }),

  P({ id: "one-line-contrarian", name: "One-Line Banger", family: "contrarian", mechanism: "contrarian", tier: "core",
    scaffold: "Hard truth: {claim}.", slots: ["claim"],
    why: "A single unhedged sentence is the native X unit — quote-posts and angry replies do the distribution",
    niches: ["business", "creators", "finance", "fitness", "general"], strength: 0.85,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"] }),

  P({ id: "everyone-is-wrong", name: "Everyone Is Wrong", family: "contrarian", mechanism: "contrarian", tier: "extended",
    scaffold: "Everyone tells you to {common_advice}. Everyone is wrong. Here's what actually works:", slots: ["common_advice"],
    why: "Mass-consensus challenge + immediate promise of the replacement — contrarian with a payoff attached",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.82,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"] }),

  P({ id: "list-colon-promise", name: "Colon List Promise", family: "value", mechanism: "value", tier: "core",
    scaffold: "{n} {things} I'd use to {goal} if I started from zero:", slots: ["n", "things", "goal"],
    why: "The trailing colon is text-native scroll-stop punctuation — the post visibly continues below the fold",
    niches: ["creators", "business", "tech", "general"], strength: 0.84,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"] }),

  P({ id: "cheat-sheet", name: "Cheat Sheet Drop", family: "value", mechanism: "value", tier: "extended",
    scaffold: "The {domain} cheat sheet I wish I had at {starting_point}:", slots: ["domain", "starting_point"],
    why: "Screenshot-bait: dense utility framed as the shortcut past the author's own wasted time",
    niches: ["creators", "business", "tech", "finance", "general"], strength: 0.83,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"] }),

  P({ id: "nobody-tells-you", name: "Nobody Tells You", family: "curiosity", mechanism: "curiosity", tier: "core",
    scaffold: "What nobody tells you about {topic}:", slots: ["topic"],
    why: "Open loop + implied insider knowledge in seven words — the colon does the cliffhanger work in text",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.85,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"],
    relatedCore: ["curiosity-gap", "industry-secret"] }),

  P({ id: "read-that-again", name: "Read That Again", family: "proof", mechanism: "proof", tier: "core",
    scaffold: "{shock_stat}. Read that again.", slots: ["shock_stat"],
    why: "Forces a second pass over one concrete number — dwell time is the text feed's retention metric",
    niches: ["business", "finance", "creators", "general"], strength: 0.84,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"] }),

  P({ id: "open-books", name: "Open Books", family: "proof", mechanism: "proof", tier: "extended",
    scaffold: "I'm posting my real {metric} numbers. No blur. {n} takeaways:", slots: ["metric", "n"],
    why: "Radical transparency pre-empts the 'fake screenshot' reflex text audiences have built",
    niches: ["business", "creators", "finance", "general"], strength: 0.83,
    platforms: ["x", "linkedin", "threads"], mediums: ["text"] }),

  P({ id: "arc-playbook", name: "Arc + Playbook", family: "story", mechanism: "story", tier: "core",
    scaffold: "In {time_a} I {low}. Today I {high}. The whole playbook:", slots: ["time_a", "low", "high"],
    why: "LinkedIn-native compressed arc; ending on 'playbook' converts the story into promised utility",
    niches: ["business", "story", "creators", "finance", "general"], strength: 0.85,
    platforms: ["linkedin", "x", "threads"], mediums: ["text"] }),

  P({ id: "setback-lesson", name: "Setback Lesson", family: "story", mechanism: "story", tier: "extended",
    scaffold: "I got {setback} last {timeframe}. Here's what it taught me about {domain}.", slots: ["setback", "timeframe", "domain"],
    why: "Vulnerability-first posts consistently outperform wins on LinkedIn — loss opens, lesson pays",
    niches: ["story", "business", "creators", "general"], strength: 0.8,
    platforms: ["linkedin", "threads", "x"], mediums: ["text"] }),

  P({ id: "fill-in-blank", name: "Fill in the Blank", family: "engagement", mechanism: "engagement", tier: "extended",
    scaffold: "The most underrated {category} is ______.", slots: ["category"],
    why: "The blank is a reply form field — lowest-friction comment prompt that exists in text",
    niches: ["creators", "business", "tech", "general"], strength: 0.77,
    platforms: ["x", "threads", "linkedin"], mediums: ["text"] }),

  P({ id: "quote-repost-setup", name: "Quote-Post Setup", family: "engagement", mechanism: "engagement", tier: "extended",
    scaffold: "Quote this with your {thing} — I'll rank the best ones.", slots: ["thing"],
    why: "Engineered quote-posts: every response re-broadcasts the original to a new graph",
    niches: ["creators", "business", "general"], strength: 0.78,
    platforms: ["x", "threads"], mediums: ["text"] }),

  P({ id: "delete-this-later", name: "Delete This Later", family: "interrupt", mechanism: "interrupt", tier: "extended",
    scaffold: "I'll probably delete this, but {confession}.", slots: ["confession"],
    why: "Manufactured ephemerality — perceived risk makes a plain confession feel like leaked intel",
    niches: ["story", "creators", "business", "general"], strength: 0.76,
    platforms: ["x", "threads"], mediums: ["text"] }),

  // ========== EXTENDED ==========
  P({ id: "odd-number-list", name: "Odd-Number List", family: "value", mechanism: "value", tier: "extended",
    scaffold: "{odd_n} weirdly effective ways to {goal}.", slots: ["odd_n", "goal"],
    why: "Odd counts feel less manufactured than round tens",
    niches: ["creators", "business", "tech", "general"], strength: 0.78, evidence: "market-observed" }),

  P({ id: "negative-promise", name: "Negative Promise", family: "warning", mechanism: "warning", tier: "extended",
    scaffold: "This will not make you {fantasy}. It will make you {real_outcome}.", slots: ["fantasy", "real_outcome"],
    why: "Trust through lowered, precise expectations",
    niches: ["fitness", "finance", "business", "general"], strength: 0.81 }),

  P({ id: "expert-wrong", name: "Experts Are Wrong", family: "contrarian", mechanism: "contrarian", tier: "extended",
    scaffold: "Every {expert_type} told me to {advice}. They were wrong.", slots: ["expert_type", "advice"],
    why: "Status challenge against authority",
    niches: ["business", "fitness", "creators", "general"], strength: 0.8 }),

  P({ id: "timeline-twist", name: "Timeline Twist", family: "story", mechanism: "story", tier: "extended",
    scaffold: "At {time_a} I {low}. At {time_b} I {high}. Same person.", slots: ["time_a", "low", "time_b", "high"],
    why: "Compressed arc with identity continuity",
    niches: ["story", "business", "fitness", "creators", "general"], strength: 0.83 }),

  P({ id: "forbidden-tactic", name: "Forbidden Tactic", family: "curiosity", mechanism: "curiosity", tier: "extended",
    scaffold: "The tactic {gatekeepers} hope you never learn:", slots: ["gatekeepers"],
    why: "Forbidden fruit + us-vs-them",
    niches: ["business", "creators", "finance", "general"], strength: 0.79 }),

  P({ id: "micro-confession", name: "Micro Confession", family: "story", mechanism: "story", tier: "extended",
    scaffold: "I need to admit something about {topic}.", slots: ["topic"],
    why: "Vulnerability opens attention before the lesson",
    niches: ["story", "creators", "business", "general"], strength: 0.8, textOnScreen: false }),

  P({ id: "speed-run", name: "Speed-Run Tutorial", family: "value", mechanism: "value", tier: "extended",
    scaffold: "{goal} in under {minutes} minutes — no fluff.", slots: ["goal", "minutes"],
    why: "Time-bound utility promise",
    niches: ["tech", "creators", "business", "general"], strength: 0.82 }),

  P({ id: "common-enemy", name: "Common Enemy", family: "contrarian", mechanism: "contrarian", tier: "extended",
    scaffold: "Your problem isn't you. It's {enemy_system}.", slots: ["enemy_system"],
    why: "Externalizes blame onto a system, then teaches the fix",
    niches: ["business", "creators", "finance", "general"], strength: 0.84 }),

  P({ id: "receipts-open", name: "Receipts Open", family: "proof", mechanism: "proof", tier: "extended",
    scaffold: "Don't trust me. Trust the {receipt_type}.", slots: ["receipt_type"],
    why: "Pre-empts skepticism with evidence frame",
    niches: ["business", "finance", "creators", "tech", "general"], strength: 0.85 }),

  P({ id: "loop-callback", name: "Loop / Callback", family: "interrupt", mechanism: "interrupt", tier: "extended",
    scaffold: "[End line matches open] — wait for the loop.", slots: [],
    why: "Rewatch bait via structural loop",
    niches: ["creators", "story", "general"], strength: 0.77, evidence: "market-observed", mediums: ["video"] }),

  P({ id: "wrong-then-right", name: "Wrong, Then Right", family: "mistake", mechanism: "mistake", tier: "extended",
    scaffold: "I got {topic} completely wrong. Here's the fix.", slots: ["topic"],
    why: "Authority through corrected error",
    niches: ["business", "creators", "tech", "general"], strength: 0.83 }),

  P({ id: "niche-callout", name: "Niche Callout", family: "identity", mechanism: "identity", tier: "extended",
    scaffold: "This is only for {narrow_identity}. Everyone else scroll.", slots: ["narrow_identity"],
    why: "Exclusion increases relevance for the right viewer",
    niches: ["creators", "fitness", "business", "tech", "general"], strength: 0.81 }),

  P({ id: "price-of-inaction", name: "Price of Inaction", family: "mistake", mechanism: "mistake", tier: "extended",
    scaffold: "Ignoring {problem} is already costing you {cost}.", slots: ["problem", "cost"],
    why: "Loss framing on the status quo",
    niches: ["business", "finance", "creators", "general"], strength: 0.82 }),

  P({ id: "template-giveaway", name: "Template Giveaway Hook", family: "value", mechanism: "value", tier: "extended",
    scaffold: "Copy my exact {asset} for {use_case}. Free.", slots: ["asset", "use_case"],
    why: "Tangible stealable asset",
    niches: ["creators", "business", "tech", "general"], strength: 0.8 }),

  P({ id: "day-in-life-lie", name: "Day-in-the-Life Myth", family: "contrarian", mechanism: "contrarian", tier: "extended",
    scaffold: "My real {role} day looks nothing like what you see online.", slots: ["role"],
    why: "Authenticity contrast vs polished feeds",
    niches: ["creators", "business", "story", "general"], strength: 0.79 }),

  P({ id: "algorithm-truth", name: "Algorithm Truth", family: "authority", mechanism: "authority", tier: "extended",
    scaffold: "The algorithm doesn't reward {myth}. It rewards {truth}.", slots: ["myth", "truth"],
    why: "Platform literacy as authority",
    niches: ["creators", "business", "general"], strength: 0.84 }),

  P({ id: "client-whisper", name: "Client Whisper", family: "authority", mechanism: "authority", tier: "extended",
    scaffold: "What I tell paying clients about {topic}:", slots: ["topic"],
    why: "Paid-access framing raises perceived value",
    niches: ["business", "creators", "finance", "tech", "general"], strength: 0.83 }),

  P({ id: "two-types", name: "Two Types of People", family: "identity", mechanism: "identity", tier: "extended",
    scaffold: "There are two types of {audience}. Only one {wins}.", slots: ["audience", "wins"],
    why: "Forced self-categorization",
    niches: ["business", "fitness", "creators", "general"], strength: 0.8 }),

  P({ id: "screenshot-this", name: "Screenshot This", family: "engagement", mechanism: "engagement", tier: "extended",
    scaffold: "Screenshot this before you {action}.", slots: ["action"],
    why: "Save/share behavior prompt",
    niches: ["creators", "business", "finance", "general"], strength: 0.76 }),

  P({ id: "unpopular-process", name: "Unpopular Process", family: "contrarian", mechanism: "contrarian", tier: "extended",
    scaffold: "Unpopular process: I {counterintuitive_step} on purpose.", slots: ["counterintuitive_step"],
    why: "Curiosity via process heresy",
    niches: ["creators", "business", "tech", "general"], strength: 0.81 }),

  P({ id: "metric-shock", name: "Metric Shock", family: "proof", mechanism: "proof", tier: "extended",
    scaffold: "{metric} went from {low} to {high}. No ads.", slots: ["metric", "low", "high"],
    why: "Shock number + constraint",
    niches: ["business", "creators", "finance", "tech", "general"], strength: 0.86 }),

  P({ id: "beginner-trap", name: "Beginner Trap", family: "mistake", mechanism: "mistake", tier: "extended",
    scaffold: "Beginners always {trap}. Pros do this instead.", slots: ["trap"],
    why: "Status ladder + correction",
    niches: ["creators", "fitness", "business", "tech", "general"], strength: 0.84 }),

  P({ id: "late-to-party", name: "Late to the Party", family: "story", mechanism: "story", tier: "extended",
    scaffold: "I was late to {trend}. That was an advantage.", slots: ["trend"],
    why: "Reframes FOMO into strategy",
    niches: ["business", "creators", "tech", "general"], strength: 0.78 }),

  P({ id: "one-rule", name: "One Rule Only", family: "value", mechanism: "value", tier: "extended",
    scaffold: "If you only follow one rule for {domain}, make it this.", slots: ["domain"],
    why: "Extreme prioritization feels like a gift",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.85 }),

  P({ id: "visual-first-claim", name: "Visual-First Claim", family: "interrupt", mechanism: "interrupt", tier: "extended",
    scaffold: "[Show result first] Voiceover: this took {timeframe}.", slots: ["timeframe"],
    why: "Payoff before explanation fights swipe",
    niches: ["fitness", "creators", "tech", "general"], strength: 0.84, spoken: true, mediums: ["video"] }),

  P({ id: "comment-prompt-split", name: "A/B Comment Split", family: "engagement", mechanism: "engagement", tier: "extended",
    scaffold: "Team A: {option_a}. Team B: {option_b}. Fight.", slots: ["option_a", "option_b"],
    why: "Binary tribal comment engine",
    niches: ["creators", "business", "general"], strength: 0.75,
    platforms: ["tiktok", "reels", "shorts", "x"] }),

  P({ id: "steal-my-stack", name: "Steal My Stack", family: "value", mechanism: "value", tier: "extended",
    scaffold: "Steal my entire {stack_type} stack.", slots: ["stack_type"],
    why: "Full-system utility promise",
    niches: ["creators", "tech", "business", "general"], strength: 0.82 }),

  P({ id: "quiet-flex", name: "Quiet Flex", family: "proof", mechanism: "proof", tier: "extended",
    scaffold: "I don't post about {win} often. Today I will.", slots: ["win"],
    why: "Scarcity of brag raises credibility",
    niches: ["business", "creators", "finance", "story", "general"], strength: 0.77 }),

  P({ id: "fix-diagnosis", name: "Tool Diagnosis", family: "diagnosis", mechanism: "diagnosis", tier: "extended",
    scaffold: "If your {tool} looks like this, you have {named_problem}.", slots: ["tool", "named_problem"],
    why: "Visual diagnosis + named problem (modern halitosis pattern)",
    niches: ["creators", "tech", "business", "general"], strength: 0.85,
    relatedCore: ["name-unnamed-fear"] }),

  P({ id: "calendar-truth", name: "Calendar Truth", family: "authority", mechanism: "authority", tier: "extended",
    scaffold: "Here's my real posting calendar — not the guru version.", slots: [],
    why: "Behind-curtain ops content",
    niches: ["creators", "business", "general"], strength: 0.8 }),

  P({ id: "hook-about-hooks", name: "Meta Hook", family: "curiosity", mechanism: "curiosity", tier: "extended",
    scaffold: "This open is why your last {n} videos died.", slots: ["n"],
    why: "Self-referential pattern interrupt for creator niches",
    niches: ["creators", "general"], strength: 0.83 }),

  P({ id: "permission-to-quit", name: "Permission to Quit", family: "contrarian", mechanism: "contrarian", tier: "extended",
    scaffold: "Quit {thing} if you can't do {minimum_standard}.", slots: ["thing", "minimum_standard"],
    why: "Harsh filter builds authority with serious viewers",
    niches: ["fitness", "business", "creators", "general"], strength: 0.78 }),

  P({ id: "tiny-lever", name: "Tiny Lever", family: "value", mechanism: "value", tier: "extended",
    scaffold: "A {tiny_change} moved my {metric} more than {big_effort}.", slots: ["tiny_change", "metric", "big_effort"],
    why: "Disproportionate leverage story",
    niches: ["business", "creators", "fitness", "tech", "general"], strength: 0.86 }),

  P({ id: "audience-secret", name: "Audience Secret", family: "authority", mechanism: "authority", tier: "extended",
    scaffold: "My audience taught me this about {topic}.", slots: ["topic"],
    why: "Credit-shifting authority feels earned",
    niches: ["creators", "business", "general"], strength: 0.79 }),

  P({ id: "first-second-script", name: "First-Second Script", family: "interrupt", mechanism: "interrupt", tier: "extended",
    scaffold: "Second 0: {visual_shock}. Second 1: {claim}.", slots: ["visual_shock", "claim"],
    why: "Forces shot-level hook design",
    niches: ["creators", "general"], strength: 0.82, mediums: ["video"] }),

  P({ id: "niche-math", name: "Niche Math", family: "proof", mechanism: "proof", tier: "extended",
    scaffold: "{small_niche} × {high_intent} beats {big_audience} every time.", slots: ["small_niche", "high_intent", "big_audience"],
    why: "Strategic contrarian with arithmetic feel",
    niches: ["business", "creators", "general"], strength: 0.84 }),

  P({ id: "voiceover-vs-text", name: "Spoken vs Text Hook", family: "value", mechanism: "value", tier: "extended",
    scaffold: "Say this out loud: \"{spoken}\". Put this on screen: \"{text}\".", slots: ["spoken", "text"],
    why: "Platform-native dual-channel open",
    niches: ["creators", "general"], strength: 0.8, mediums: ["video"] }),

  P({ id: "deadline-energy", name: "Deadline Energy", family: "warning", mechanism: "warning", tier: "extended",
    scaffold: "You have until {deadline} before {consequence}.", slots: ["deadline", "consequence"],
    why: "Time pressure with concrete consequence",
    niches: ["business", "finance", "creators", "general"], strength: 0.76, evidence: "hypothesis" }),

  P({ id: "anti-guru", name: "Anti-Guru", family: "contrarian", mechanism: "contrarian", tier: "extended",
    scaffold: "If a guru says {claim}, run.", slots: ["claim"],
    why: "Trust via rejecting hype class",
    niches: ["business", "fitness", "finance", "creators", "general"], strength: 0.8 }),

  P({ id: "case-study-cold", name: "Cold Case Study", family: "proof", mechanism: "proof", tier: "extended",
    scaffold: "Case study: {subject} did {action}. Result: {result}.", slots: ["subject", "action", "result"],
    why: "Third-party proof frame",
    niches: ["business", "tech", "creators", "general"], strength: 0.85,
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"] }),

  P({ id: "series-cold-open", name: "Series Cold Open", family: "curiosity", mechanism: "curiosity", tier: "extended",
    scaffold: "Episode 1: the mistake that started everything.", slots: [],
    why: "Serialized open loop across posts",
    niches: ["story", "creators", "business", "general"], strength: 0.81 }),

  P({ id: "role-reversal", name: "Role Reversal", family: "story", mechanism: "story", tier: "extended",
    scaffold: "I used to buy {thing}. Now I sell it. Here's the shift.", slots: ["thing"],
    why: "Status flip narrative",
    niches: ["business", "story", "finance", "general"], strength: 0.82 }),

  // ========== HISTORICAL (classic mechanisms; still viable) ==========
  P({ id: "halitosis-diagnosis", name: "Halitosis Pattern (Diagnosis Branding)", family: "diagnosis", mechanism: "diagnosis", tier: "historical",
    scaffold: "There's a name for what you're struggling with: {named_diagnosis}.", slots: ["named_diagnosis"],
    why: "Listerine popularized naming an unnamed social fear so people self-diagnose and seek the cure",
    niches: ["business", "creators", "fitness", "finance", "general"], strength: 0.91,
    evidence: "historically-documented", era: "1920s→today",
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"],
    relatedCore: ["name-unnamed-fear", "curiosity-gap"] }),

  P({ id: "problem-agitate-solve", name: "Problem–Agitate–Solve", family: "mistake", mechanism: "mistake", tier: "historical",
    scaffold: "You know {problem}. What you don't feel yet is {agitation}. Here's the way out.", slots: ["problem", "agitation"],
    why: "Classic direct-response spine: state pain, twist the knife, present relief",
    niches: ["business", "finance", "fitness", "general"], strength: 0.9,
    evidence: "historically-documented", era: "direct-response classic",
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin"] }),

  P({ id: "unique-mechanism", name: "Unique Mechanism", family: "curiosity", mechanism: "curiosity", tier: "historical",
    scaffold: "The difference isn't effort. It's {mechanism_name}.", slots: ["mechanism_name"],
    why: "DR classic: name a proprietary-seeming reason results happen",
    niches: ["business", "fitness", "finance", "tech", "general"], strength: 0.88,
    evidence: "historically-documented", era: "direct-response classic" }),

  P({ id: "reason-why", name: "Reason-Why Advertising", family: "proof", mechanism: "proof", tier: "historical",
    scaffold: "Why {claim}? Because {specific_reason}.", slots: ["claim", "specific_reason"],
    why: "John E. Kennedy / Hopkins lineage: specific reasons outsell slogans",
    niches: ["business", "finance", "tech", "general"], strength: 0.87,
    evidence: "historically-documented", era: "early 1900s→today",
    platforms: ["tiktok", "reels", "shorts", "youtube", "linkedin", "x"] }),

  P({ id: "preemptive-objection", name: "Preemptive Objection", family: "authority", mechanism: "authority", tier: "historical",
    scaffold: "You're probably thinking {objection}. Fair. Here's the answer.", slots: ["objection"],
    why: "Steals the viewer's doubt before they swipe",
    niches: ["business", "finance", "creators", "general"], strength: 0.84,
    evidence: "historically-documented", era: "sales classic→social" }),

  P({ id: "demonstration-first", name: "Demonstration First", family: "proof", mechanism: "proof", tier: "historical",
    scaffold: "[Demo the result] — now I'll show how.", slots: [],
    why: "Show-don't-tell from product demos and TV spots; short-form native",
    niches: ["tech", "fitness", "creators", "general"], strength: 0.89,
    evidence: "historically-documented", era: "TV demo→TikTok", mediums: ["video"] }),

  P({ id: "before-after-bridge", name: "Before–After–Bridge", family: "story", mechanism: "story", tier: "historical",
    scaffold: "Before: {before}. After: {after}. The bridge was {bridge}.", slots: ["before", "after", "bridge"],
    why: "Copywriting staple: two states + the path between them",
    niches: ["fitness", "business", "finance", "creators", "general"], strength: 0.88,
    evidence: "historically-documented", era: "copywriting classic",
    relatedCore: ["before-after", "time-boxed-result"] }),

  P({ id: "open-loop-zeigarnik", name: "Open Loop (Zeigarnik)", family: "curiosity", mechanism: "curiosity", tier: "historical",
    scaffold: "I'll tell you the third rule last — first, the one everyone skips.", slots: [],
    why: "Unfinished mental tasks hold memory; classic serial and cliffhanger physics",
    niches: ["creators", "story", "education", "general"], strength: 0.86,
    evidence: "historically-documented", era: "psychology→media",
    relatedCore: ["curiosity-gap", "series-cold-open"] }),

  P({ id: "social-proof-stack", name: "Social Proof Stack", family: "proof", mechanism: "proof", tier: "historical",
    scaffold: "{n} {identity} already {action}. You're next — or not.", slots: ["n", "identity", "action"],
    why: "Cialdini-style proof; works when numbers are real",
    niches: ["business", "fitness", "creators", "general"], strength: 0.83,
    evidence: "historically-documented", era: "psychology classic" }),

  P({ id: "enemy-narrative", name: "Enemy Narrative", family: "contrarian", mechanism: "contrarian", tier: "historical",
    scaffold: "{enemy} profits when you keep {bad_habit}.", slots: ["enemy", "bad_habit"],
    why: "Us-vs-them story used in politics, brands, and movements for a century",
    niches: ["business", "finance", "fitness", "creators", "general"], strength: 0.84,
    evidence: "historically-documented", era: "propaganda/brand classic→social",
    relatedCore: ["industry-secret", "common-enemy"] }),

  P({ id: "specific-starving-crowd", name: "Starving Crowd Specificity", family: "identity", mechanism: "identity", tier: "historical",
    scaffold: "If you're a {ultra_specific_person}, this is for you.", slots: ["ultra_specific_person"],
    why: "Gary Halbert idea: message to a hungry specific market beats clever mass copy",
    niches: ["business", "creators", "finance", "general"], strength: 0.87,
    evidence: "historically-documented", era: "direct-mail classic→niches",
    relatedCore: ["niche-callout", "pov-identity"] }),

  P({ id: "fascination-bullets", name: "Fascination Bullets", family: "curiosity", mechanism: "curiosity", tier: "historical",
    scaffold: "Why {odd_fact} changes how you {action} forever.", slots: ["odd_fact", "action"],
    why: "Bullet-style fascinations from mail-order books; short-form as single bullets",
    niches: ["business", "finance", "creators", "general"], strength: 0.85,
    evidence: "historically-documented", era: "mail-order classic" }),

  P({ id: "new-discovery", name: "New Discovery Frame", family: "curiosity", mechanism: "curiosity", tier: "historical",
    scaffold: "A new way to {goal} without {sacrifice}.", slots: ["goal", "sacrifice"],
    why: "Discovery framing from patent-medicine to SaaS; promise relief without the old pain",
    niches: ["fitness", "tech", "business", "general"], strength: 0.8,
    evidence: "historically-documented", era: "print→digital", evidenceNote: "Easy to abuse — keep claims honest" }),

  P({ id: "testimonial-cold", name: "Cold Testimonial Open", family: "proof", mechanism: "proof", tier: "historical",
    scaffold: "\"{quote}\" — that's what {person} said after {result}.", slots: ["quote", "person", "result"],
    why: "Borrowed voice proof; as old as advertising",
    niches: ["business", "fitness", "finance", "general"], strength: 0.82,
    evidence: "historically-documented", era: "print classic→UGC" }),

  P({ id: "question-headline", name: "Question Headline", family: "engagement", mechanism: "engagement", tier: "historical",
    scaffold: "What if {reframe}?", slots: ["reframe"],
    why: "Print headline staple; works when the question is specific, not vague",
    niches: ["business", "creators", "finance", "general"], strength: 0.8,
    evidence: "historically-documented", era: "print headlines→captions",
    platforms: ["tiktok", "reels", "shorts", "linkedin", "x", "youtube"] }),

  P({ id: "how-to-promise", name: "How-To Promise", family: "value", mechanism: "value", tier: "historical",
    scaffold: "How to {desirable_outcome} without {common_pain}.", slots: ["desirable_outcome", "common_pain"],
    why: "Evergreen utility headline formula from magazines to YouTube",
    niches: ["tech", "business", "creators", "fitness", "general"], strength: 0.86,
    evidence: "historically-documented", era: "magazine→YouTube" }),

  P({ id: "slippery-slope-warning", name: "Slippery Slope Warning", family: "warning", mechanism: "warning", tier: "historical",
    scaffold: "First {small_mistake}. Then {worse}. Then {catastrophe}.", slots: ["small_mistake", "worse", "catastrophe"],
    why: "Escalation narrative used in PSAs and DR; strong if not cartoonish",
    niches: ["finance", "fitness", "creators", "general"], strength: 0.78,
    evidence: "historically-documented", era: "PSA/DR classic" }),

  P({ id: "insider-language", name: "Insider Language", family: "identity", mechanism: "identity", tier: "historical",
    scaffold: "If you know what {jargon} means, keep watching.", slots: ["jargon"],
    why: "Tribal filter — related to diagnosis naming but for in-groups",
    niches: ["tech", "finance", "creators", "business", "general"], strength: 0.81,
    evidence: "historically-documented", era: "subculture→internet" }),

  P({ id: "challenge-dare", name: "Challenge / Dare", family: "engagement", mechanism: "engagement", tier: "historical",
    scaffold: "I dare you to try {challenge} for {duration}.", slots: ["challenge", "duration"],
    why: "Contest/challenge framing from radio and print promotions",
    niches: ["fitness", "creators", "business", "general"], strength: 0.8,
    evidence: "historically-documented", era: "promo classic→challenges" }),

  P({ id: "plain-speak-shock", name: "Plain-Speak Shock", family: "interrupt", mechanism: "interrupt", tier: "historical",
    scaffold: "Plain English: {blunt_truth}.", slots: ["blunt_truth"],
    why: "Anti-jargon bluntness as interrupt — works in every era of hype",
    niches: ["business", "finance", "creators", "general"], strength: 0.83,
    evidence: "historically-documented", era: "copy classic→social" }),

  P({ id: "story-sell", name: "Story Sell Open", family: "story", mechanism: "story", tier: "historical",
    scaffold: "It was {setting} when I realized {insight}.", slots: ["setting", "insight"],
    why: "Narrative open from long-form sales letters; still works as short cold open",
    niches: ["story", "business", "creators", "general"], strength: 0.84,
    evidence: "historically-documented", era: "sales letters→talking-head",
    textOnScreen: false }),

  P({ id: "free-curiosity", name: "Free + Curiosity", family: "value", mechanism: "value", tier: "historical",
    scaffold: "Free: the {asset} that fixed my {pain}.", slots: ["asset", "pain"],
    why: "Free is the oldest offer word; pair with a concrete asset",
    niches: ["creators", "business", "tech", "general"], strength: 0.82,
    evidence: "historically-documented", era: "retail/DR classic" }),

  P({ id: "contrast-principle", name: "Contrast Principle", family: "proof", mechanism: "proof", tier: "historical",
    scaffold: "Next to {bad_option}, {good_option} looks obvious.", slots: ["bad_option", "good_option"],
    why: "Judgment is relative — classic persuasion, great for visual edits",
    niches: ["business", "finance", "fitness", "general"], strength: 0.83,
    evidence: "historically-documented", era: "psychology classic" }),

  P({ id: "news-angle", name: "News Angle", family: "curiosity", mechanism: "curiosity", tier: "historical",
    scaffold: "New: {development} just changed {domain}.", slots: ["development", "domain"],
    why: "News value is timeless attention fuel when actually new",
    niches: ["tech", "business", "finance", "creators", "general"], strength: 0.8,
    evidence: "historically-documented", era: "journalism→creator newsjacking" }),

  P({ id: "command-headline", name: "Command Headline", family: "interrupt", mechanism: "interrupt", tier: "historical",
    scaffold: "Read this before you {action} again.", slots: ["action"],
    why: "Imperative headlines from print; direct and swipe-resistant when specific",
    niches: ["creators", "business", "fitness", "finance", "general"], strength: 0.84,
    evidence: "historically-documented", era: "print→shorts" })
];

// Historical / documented instances — evidence cards, not generation candidates
export const HISTORICAL_INSTANCES = [
  {
    id: "listerine-halitosis",
    title: "Listerine / Halitosis",
    year: "1920s",
    patternIds: ["halitosis-diagnosis", "name-unnamed-fear", "curiosity-gap"],
    mechanism: "diagnosis",
    source: "Classic Listerine print campaigns (Lambert Pharmacal); widely documented in advertising history",
    surface: "A medical-sounding word most people didn't know",
    mechanismNote: "Named an unnamed social fear (bad breath) so readers self-diagnosed and sought a cure",
    modernParallel: "Invent a crisp name for a vague creator pain: hook rot, silent follower death, content decay — then teach the fix",
    viability: "High — the word 'halitosis' is dated; the diagnosis pattern is daily short-form fuel",
    wtfJob: "WTF is that / do I have that? → investigate",
    risk: "Don't invent fake diseases or medical claims; keep diagnoses metaphorical or clearly non-clinical"
  },
  {
    id: "hopkins-reason-why",
    title: "Claude Hopkins — Reason-Why",
    year: "1900s–1920s",
    patternIds: ["reason-why", "specific-proof"],
    mechanism: "proof",
    source: "Scientific Advertising (Claude Hopkins) and early reason-why school of copy",
    surface: "Specific product reasons instead of empty praise",
    mechanismNote: "Specificity creates belief; slogans without reasons don't",
    modernParallel: "I tested X for 30 days. Here's what broke. — not 'this changes everything'",
    viability: "Very high",
    wtfJob: "Wait — there's a concrete reason?",
    risk: "Fake specifics destroy trust faster than vague claims"
  },
  {
    id: "pas-formula",
    title: "Problem–Agitate–Solve",
    year: "mid-20th c. DR",
    patternIds: ["problem-agitate-solve", "cost-of-wrong"],
    mechanism: "mistake",
    source: "Direct-response copy tradition (many teachers; PAS widely taught)",
    surface: "Pain → twist → relief",
    mechanismNote: "Emotion first, offer second",
    modernParallel: "You know your Reels die at 1s. What you don't feel yet is how that trains the algorithm to bury you.",
    viability: "High if agitation isn't cartoon cruelty",
    wtfJob: "That pain is worse than I admitted",
    risk: "Over-agitation feels manipulative in 2020s culture — calibrate"
  },
  {
    id: "zeigarnik-loops",
    title: "Open loops / cliffhangers",
    year: "psychology → serial media",
    patternIds: ["open-loop-zeigarnik", "curiosity-gap", "series-cold-open"],
    mechanism: "curiosity",
    source: "Zeigarnik-effect research lineage + centuries of serial storytelling",
    surface: "Withhold the third point; promise the answer later",
    mechanismNote: "Unfinished tasks stay active in attention",
    modernParallel: "Part 1 of 3. The mistake is in part 2.",
    viability: "High — backbone of series content",
    wtfJob: "I need the missing piece",
    risk: "Cheap 'wait for it' without payoff trains distrust"
  },
  {
    id: "halbert-starving-crowd",
    title: "Starving crowd (market first)",
    year: "20th c. direct mail",
    patternIds: ["specific-starving-crowd", "niche-callout"],
    mechanism: "identity",
    source: "Gary Halbert and direct-mail orthodoxy: message to hungry markets",
    surface: "Ultra-specific audience address",
    mechanismNote: "Relevance beats cleverness",
    modernParallel: "If you edit podcast clips for LinkedIn founders, keep watching.",
    viability: "Extremely high for niche short-form",
    wtfJob: "This is literally about me",
    risk: "Too narrow can starve reach — balance with secondary hooks"
  },
  {
    id: "fascinations-bullets",
    title: "Mail-order fascinations",
    year: "mid-20th c.",
    patternIds: ["fascination-bullets", "industry-secret"],
    mechanism: "curiosity",
    source: "Mail-order book/advertising bullet traditions",
    surface: "One odd, specific teaser line",
    mechanismNote: "Curiosity with a concrete oddity",
    modernParallel: "Why creators who post less can grow faster (if they do this).",
    viability: "High as single-line opens",
    wtfJob: "That can't be right — show me",
    risk: "Clickbait without delivery"
  },
  {
    id: "demo-tv",
    title: "TV product demonstration",
    year: "1950s→infomercials",
    patternIds: ["demonstration-first", "visual-first-claim", "before-after"],
    mechanism: "proof",
    source: "Live TV demos and later infomercial structure",
    surface: "Show the result before the lecture",
    mechanismNote: "Belief follows eyes",
    modernParallel: "Open on the finished vertical clip, then narrate the cut",
    viability: "Native to TikTok/Reels/Shorts",
    wtfJob: "How did they do that?",
    risk: "Misleading demos (fake UI, fake metrics)"
  },
  {
    id: "how-to-magazines",
    title: "Magazine how-to headlines",
    year: "20th c. magazines",
    patternIds: ["how-to-promise", "numbered-value"],
    mechanism: "value",
    source: "Service journalism / magazine cover lines",
    surface: "How to X without Y",
    mechanismNote: "Utility + removed obstacle",
    modernParallel: "How to write hooks without sounding like ChatGPT",
    viability: "Evergreen",
    wtfJob: "There's a way without the pain?",
    risk: "Generic how-tos blend into noise — add specificity"
  },
  {
    id: "plain-speak",
    title: "Plain-speak vs hype",
    year: "recurring",
    patternIds: ["plain-speak-shock", "anti-guru", "negative-promise"],
    mechanism: "interrupt",
    source: "Recurring anti-hype tradition in good advertising and essays",
    surface: "Blunt sentence after a feed full of adjectives",
    mechanismNote: "Contrast against ambient exaggeration",
    modernParallel: "Plain English: your hook is boring.",
    viability: "High in hype-saturated niches",
    wtfJob: "Finally someone said it",
    risk: "Cruelty without help feels empty"
  },
  {
    id: "command-print",
    title: "Imperative print headlines",
    year: "print era",
    patternIds: ["command-headline", "warning-psa"],
    mechanism: "interrupt",
    source: "Print display advertising commands",
    surface: "Read this before…",
    mechanismNote: "Direct address creates urgency",
    modernParallel: "Read this before you post another AI caption.",
    viability: "High when the 'before' is specific",
    wtfJob: "Am I about to make a mistake?",
    risk: "Empty urgency"
  },
  {
    id: "social-proof-ads",
    title: "Testimonial / crowd proof",
    year: "long tradition",
    patternIds: ["social-proof-stack", "testimonial-cold", "receipts-open"],
    mechanism: "proof",
    source: "Testimonial advertising across print, radio, TV, UGC",
    surface: "Other people already did the thing",
    mechanismNote: "Borrowed credibility",
    modernParallel: "Don't trust me. Trust the retention graph.",
    viability: "High when proof is real and visible",
    wtfJob: "Others like me already won",
    risk: "Fake testimonials / bought comments"
  },
  {
    id: "enemy-creation",
    title: "Enemy / system narrative",
    year: "politics & brands",
    patternIds: ["enemy-narrative", "industry-secret", "common-enemy"],
    mechanism: "contrarian",
    source: "Political communication and brand positioning history",
    surface: "A villain benefits from your bad habit",
    mechanismNote: "Shared enemy creates tribe",
    modernParallel: "The course industry profits when you buy another template instead of logging outcomes.",
    viability: "High — use carefully",
    wtfJob: "I've been played",
    risk: "Paranoia content; keep enemies structural not personal harassment"
  }
];

export const ANGLES = [
  { id: "myth-bust", name: "Myth-bust", description: "Kill a common belief in your niche", patternFamilies: ["contrarian", "curiosity"] },
  { id: "teardown", name: "Teardown / mistake", description: "Show what people get wrong", patternFamilies: ["mistake", "warning", "diagnosis"] },
  { id: "proof", name: "Proof / experiment", description: "Lead with results, tests, numbers", patternFamilies: ["proof", "value"] },
  { id: "story", name: "Story / origin", description: "Personal arc and turning points", patternFamilies: ["story", "identity", "interrupt"] },
  { id: "tactical", name: "Tactical checklist", description: "Steal-this utility and lists", patternFamilies: ["value", "engagement", "thread"] },
  { id: "diagnosis", name: "Diagnosis / named fear", description: "Name the unnamed problem (halitosis lineage)", patternFamilies: ["diagnosis", "curiosity", "mistake"] }
];

export const CTA_PATTERNS = [
  { id: "question", name: "Question bait", scaffold: "What would you try first — {a} or {b}?", why: "Forces a binary reply", mediums: ["video", "text"] },
  { id: "disagree", name: "Disagree bait", scaffold: "Agree or roast me in the comments.", why: "Polarization = comments", mediums: ["video", "text"] },
  { id: "save", name: "Save for later", scaffold: "Save this before you need it at 11pm.", why: "Saves are a strong ranking signal", mediums: ["video"] },
  { id: "duet", name: "Stitch / reply invite", scaffold: "Stitch this with your version.", why: "Platform-native distribution", mediums: ["video"] },
  { id: "follow-series", name: "Series follow", scaffold: "Part 1. Follow for the rest.", why: "Converts viewers into subscribers", mediums: ["video", "text"] },
  { id: "tag", name: "Tag someone", scaffold: "Tag the person who needs this today.", why: "Network spread via social proof", mediums: ["video", "text"] },
  { id: "reply-take", name: "Reply bait", scaffold: "Agree or disagree? One sentence, in the replies.", why: "A binary ask with a size limit — replies are the strongest text ranking signal", mediums: ["text"] },
  { id: "repost-if", name: "Repost if", scaffold: "Repost this if you'd rather {a} than {b}.", why: "Identity-flag repost: sharers self-select and broadcast the post as a badge", mediums: ["text"] },
  { id: "bookmark", name: "Bookmark bait", scaffold: "Bookmark this for the next time you {action}.", why: "Bookmarks are the save-signal of text platforms — future-need framing drives them", mediums: ["text"] },
  { id: "quote-take", name: "Quote with your take", scaffold: "Quote this with the take you're scared to post.", why: "Quote-posts spawn derivative reach — each one re-surfaces the original", mediums: ["text"] }
];

export const NICHES = [
  { id: "creators", label: "Creators / short-form" },
  { id: "business", label: "Business / SMMA" },
  { id: "fitness", label: "Fitness" },
  { id: "finance", label: "Finance" },
  { id: "tech", label: "Tech / SaaS" },
  { id: "story", label: "Story / personal brand" },
  { id: "general", label: "General" }
];

export const PLATFORMS = [
  { id: "tiktok", label: "TikTok", medium: "video" },
  { id: "reels", label: "Instagram Reels", medium: "video" },
  { id: "shorts", label: "YouTube Shorts", medium: "video" },
  { id: "youtube", label: "YouTube", medium: "video" },
  { id: "linkedin", label: "LinkedIn", medium: "text" },
  { id: "x", label: "X", medium: "text" },
  { id: "threads", label: "Threads", medium: "text" }
];

export const MEDIUMS = {
  text: { id: "text", label: "Text post", icon: "✍️" },
  video: { id: "video", label: "Video open", icon: "🎬" }
};

export function mediumForPlatform(platformId: string): string {
  // Loop body hoisted into a local only to satisfy noUncheckedIndexedAccess —
  // the guard can never be false for an in-range index, so behaviour is
  // unchanged, and the differential test proves it.
  for (var i = 0; i < PLATFORMS.length; i++) {
    var p = PLATFORMS[i];
    if (p && p.id === platformId) return p.medium || "video";
  }
  return "video"; // unknown/legacy → video
}

export const OUTCOMES = [
  { id: "winner", label: "Winner", score: 1.0, color: "pos" },
  { id: "meh", label: "Meh", score: 0.45, color: "muted" },
  { id: "dead", label: "Dead", score: 0.05, color: "neg" }
];

export const EVIDENCE_LABELS = {
  "historically-documented": "Historically documented",
  "market-observed": "Market-observed",
  "creator-ledger": "Creator-ledger proven",
  "hypothesis": "Hypothesis"
};

export const TIER_LABELS = {
  core: "Core",
  extended: "Extended",
  historical: "Historical"
};

export function patternsByTier(tier: string): any[] {
  return PATTERNS.filter(function (p) { return p.tier === tier; });
}

export function countByTier(): Record<string, number> {
  return {
    core: patternsByTier("core").length,
    extended: patternsByTier("extended").length,
    historical: patternsByTier("historical").length,
    total: PATTERNS.length,
    instances: HISTORICAL_INSTANCES.length
  };
}

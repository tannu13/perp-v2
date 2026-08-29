/**
 * The build log for the frontend.
 *
 * Kept in the repo on purpose: the decisions are the interesting part of a
 * design system, and they are exactly what gets lost once the tokens look
 * inevitable in hindsight. Each entry records what was chosen AND what was
 * given up — a decision with no stated trade-off is usually just a default.
 */

export type Decision = {
  id: string;
  title: string;
  choice: string;
  rationale: string;
  tradeoff: string;
};

export type Step = {
  phase: string;
  title: string;
  status: "done" | "active" | "next";
  body: string;
  detail?: string[];
};

/** Stack forks resolved before any token was written. */
export const stackDecisions: Decision[] = [
  {
    id: "framework",
    title: "Framework",
    choice: "Next.js App Router",
    rationale:
      "Routing, route groups and a marketing surface come free, and the terminal is one route group away from the landing page.",
    tradeoff:
      "SSR earns almost nothing here — the terminal is entirely client-side and realtime. A Vite SPA would have been the leaner honest fit.",
  },
  {
    id: "styling",
    title: "Token authoring",
    choice: "Tailwind v4 @theme",
    rationale:
      "CSS-first tokens generate their own utilities, so a semantic token and its class name cannot drift apart. One definition, one source of truth.",
    tradeoff:
      "Ties the token layer to Tailwind's namespace rules — which bit immediately, see the duration gap below.",
  },
  {
    id: "theme",
    title: "Theme scope",
    choice: "Dark-only",
    rationale:
      "What every serious trading terminal ships, and it concentrates effort on getting one theme genuinely right rather than two adequately.",
    tradeoff:
      "Light mode is deferred, not free — but because components only ever read Layer 2, adding it is a remap of one file rather than a component refactor.",
  },
  {
    id: "charts",
    title: "Charting",
    choice: "TradingView Lightweight Charts",
    rationale:
      "45kb, purpose-built for candles plus volume plus crosshair, and themeable from our own color tokens.",
    tradeoff:
      "Less composable than a React-native charting library; custom overlays mean working through its imperative API.",
  },
];

/** Design calls made while building the token layer. */
export const designDecisions: Decision[] = [
  {
    id: "primary-not-green",
    title: "Primary is blue, not the buy green",
    choice: "--color-interactive → primary-500",
    rationale:
      "Backpack's primary CTA is green and it works, because for them green IS buy. Splitting them keeps green meaning exactly one thing: direction.",
    tradeoff:
      "Loses the single-accent cohesion of the reference. Worth it — if the confirm button, active tab and a long position shared a hue, green would stop carrying information.",
  },
  {
    id: "buy-vs-buy-text",
    title: "buy and buy-text are separate tokens",
    choice: "long-500 for fills, long-400 for type",
    rationale:
      "The fill green fails contrast as 11px type on the near-black canvas. Green numbers need the lighter step.",
    tradeoff:
      "Two tokens where designers expect one, so it needs documenting — a single token would have forced a choice between a washed-out button and unreadable book rows.",
  },
  {
    id: "health-ramp",
    title: "Margin health is its own ramp",
    choice: "Four stops, separate from feedback",
    rationale:
      "Liquidation proximity is a domain signal, not a UI state. Aliasing it to success/warning/danger couples two things that will be retuned independently.",
    tradeoff:
      "Four more tokens, and a near-duplicate of the feedback palette today. They diverge the first time either is adjusted.",
  },
  {
    id: "cva",
    title: "Variants typed, not hand-written",
    choice: "CVA + a configured tailwind-merge",
    rationale:
      "A Button carrying intent × size × state is where class strings rot. CVA makes the matrix declarative and the props type-safe, so an invalid intent fails at compile time.",
    tradeoff:
      "Three more dependencies and a merge layer that has to be taught the custom token scale — which itself turned out to be load-bearing rather than optional.",
  },
  {
    id: "native-controls",
    title: "Native elements under every control",
    choice: "Real inputs and selects, styled via peer/appearance-none",
    rationale:
      "Keyboard behaviour, form participation and the mobile picker come free and correct. A custom listbox would need focus trapping and type-ahead just to match the platform.",
    tradeoff:
      "Less styling control — the native select's open dropdown is OS-rendered and cannot be themed beyond option colors.",
  },
  {
    id: "inset-reversed",
    title: "Inputs are raised — reversed after review",
    choice: "--color-surface-input sits above the panel",
    rationale:
      "The first pass recessed inputs on the theory that a well reads as 'type here'. In the built terminal they disappeared into the page, and every comparable product (Backpack, Binance, Bybit, Hyperliquid, dYdX) raises inputs on dark themes. The minority convention lost on contact with the real screen.",
    tradeoff:
      "surface-inset had to be re-scoped to genuinely recessed things — slider grooves, table headers — rather than deleted, so the token now means something narrower than its name suggests.",
  },
  {
    id: "dimmed-directionals",
    title: "Directional ramps dimmed",
    choice: "Greens ~8-11:1 down to ~6.4-7.6:1",
    rationale:
      "Measured rather than eyeballed: the originals sat far above the 4.5:1 AA floor, and on a screen that is mostly green and red that surplus read as glare. Every step still clears AA for body text.",
    tradeoff:
      "Less headroom for future dark-on-colour combinations, and short-600 is now large-text-only at 3.4:1.",
  },
];

/** What actually happened, in order. */
export const buildSteps: Step[] = [
  {
    phase: "00",
    title: "Read the system before drawing anything",
    status: "done",
    body: "Mapped the existing backend contract from source rather than assuming it — the REST surface, the websocket feed shapes and the database enums are what the UI has to model.",
    detail: [
      "11 REST endpoints behind JWT bearer auth",
      "WS feeds: last-traded-price, mark-price, depth, trades",
      "Depth arrives as [price, qty] string tuples — decimals stay strings end to end",
      "Gap found: no private user channel yet, so fills and order status are REST-only for now",
    ],
  },
  {
    phase: "01",
    title: "Resolve the stack forks",
    status: "done",
    body: "Four decisions that would have been expensive to reverse later: framework, token authoring, theme scope and charting. Settled before a line of CSS.",
  },
  {
    phase: "02",
    title: "Build the two-layer token system",
    status: "done",
    body: "Layer 1 primitives — raw ramps with no opinion about usage. Layer 2 semantic aliases pointing at them. Components read only Layer 2, which is the whole reason a theme swap is a one-file edit.",
    detail: [
      "5 primitive ramps → 58 semantic tokens",
      "Type scale: display through micro, plus a tabular numeric set",
      "4px spatial grid from a single multiplier",
      "Radii, borders, elevation, motion, breakpoints, layout constants",
    ],
  },
  {
    phase: "03",
    title: "Verify the tokens actually compile",
    status: "done",
    body: "Grepped the compiled CSS for every token family rather than trusting the build's green checkmark. This caught a real bug.",
    detail: [
      "Tailwind v4 has no --duration-* theme namespace — the variables existed but generated no utility classes, silently",
      "Fixed by registering the four named speeds via @utility",
      "Re-verified: 13 token families generate, keyframes included",
    ],
  },
  {
    phase: "04",
    title: "Catch the tree-shaking trap",
    status: "done",
    body: "Rendering the styleguide exposed a second silent failure — two neutral steps were undefined at runtime and fell back to inherited text color. Plain @theme drops any variable no utility class references, and this page reads tokens through var() in inline styles, which the scanner cannot see.",
    detail: [
      "Symptom: the neutral ramp rendered light-dark-light at the top end",
      "Cause: --color-neutral-200 and -50 were tree-shaken out of :root",
      "Would also have silently broken every --size-* layout constant",
      "Fixed with @theme static, which emits all declared variables",
      "Re-verified 31 tokens resolve in the browser, not just in the build",
    ],
  },
  {
    phase: "05",
    title: "Base components",
    status: "done",
    body: "Eighteen atoms built from the tokens, variants typed through CVA. Every interactive control implements the same six states, and Field owns the label/hint/error accessibility wiring so no input re-implements it.",
    detail: [
      "cn() had to teach tailwind-merge the custom type scale — stock behaviour silently drops text-body-md when it meets text-buy-text, which would have stripped the size off every button",
      "12 merge cases pinned in a throwaway test before any component was written",
      "NumericInput is a text input, not type=number: number inputs discard malformed values and scroll-mutate on hover, which is unacceptable for money",
      "Delta and Side close the Phase 1 colorblind gap — the sign and the word are not optional props",
      "Verified in-browser: label binding 23/23, aria-invalid wired to role=alert, roving tabindex on the segmented control",
    ],
  },
  {
    phase: "06",
    title: "Design pass — type and signature",
    status: "done",
    body: "A deliberate check against the design-lead brief before organisms get built on top. Two gaps: the type pairing was the reflexive choice, and the system had no signature element. Both are cheap to change now and expensive after Phase 3 builds dense surfaces.",
    detail: [
      "Ran a specimen bake-off — Inter vs IBM Plex Sans vs Archivo vs Instrument Sans, in a real order book at 11-13px",
      "Chose IBM Plex on a structural argument: mono and sans sit adjacent in the same table row, and a superfamily keeps those columns optically aligned",
      "Dropped Inter's cv05/ss03 feature settings, which do not exist in Plex",
      "Added slashed zero on monospace only — order ids get transcribed, prose does not",
      "Signature: the seam. Opposing quantities meet at a join whose position is the ratio, and the value sits on the join",
    ],
  },
  {
    phase: "07",
    title: "Design review pass",
    status: "done",
    body: "First round of feedback against the built terminal. Four of five points held; the fifth was misdiagnosed in a useful way — the % buttons and the leverage slider were read as duplicates, which is a labelling failure rather than a redundant control.",
    detail: [
      "Inputs raised instead of recessed, 44px with 20px figures in the ticket only — tables stay dense",
      "Leverage slider rebuilt: its track was surface-inset on a dark panel, so only the thumb was visible",
      "% row labelled 'of buying power' and grouped with Quantity; leverage moved behind a divider",
      "Directional ramps dimmed against measured contrast, muted fills 24% → 22%",
      "Ticket Seam cut — it showed nothing at 0% and Margin required already states it",
      "Post/reduce-only collapsed behind an Advanced disclosure",
    ],
  },
  {
    phase: "08",
    title: "Overlays, scrolling and elevation",
    status: "done",
    body: "Radix took over the behaviour-heavy overlays, the terminal became a fixed viewport shell, and every section finally got an elevation. Driven by real feedback against the built screen rather than a checklist.",
    detail: [
      "Radix Dialog, Tabs, Tooltip and ScrollArea — used directly rather than via the shadcn CLI, which would have injected its own token vocabulary into globals.css",
      "ScrollArea is now the default scroll region: its overlay scrollbar takes no layout width, so a native bar can no longer appear mid-stream and reflow the rows beneath it",
      "Terminal is h-dvh + overflow-hidden at lg; min-height floors totalling ~622px were forcing a page scrollbar on short laptops",
      "scrollbar-gutter: stable reserves the page scrollbar permanently",
      "Every section is a raised panel on the base canvas, separated by an 8px seam — the market bar included, since full-bleed stopped aligning once the gutter was reserved",
      "Order-book depth bars split into two nested tints: cumulative behind, the level's own size in front",
      "Deposit dialog added, mapping to POST /order/onramp",
    ],
  },
  {
    phase: "09",
    title: "Waiting, absence and failure",
    status: "done",
    body: "Every surface that depends on a network now has three designed states instead of one. The rule that fell out of it: check loading BEFORE empty, or an account with no positions flashes “No open positions” on every page load — telling someone something false about their money.",
    detail: [
      "Skeleton, SkeletonRows and SkeletonTable pinned to --size-row and to the real table's min-width, so nothing shifts when data lands",
      "EmptyState and ErrorState share one structure, so a panel's height does not jump between empty, failed and loaded",
      "Error states are `danger`, never `sell` — red means SHORT everywhere else, so the triangle glyph and the heading carry the meaning",
      "The order book now distinguishes “socket still opening” from “the book is genuinely empty”; a permanent shimmer on a quiet market is a lie",
      "The chart's placeholder is candle-shaped — a grey rectangle reads as a broken chart",
    ],
  },
  {
    phase: "10",
    title: "Toasts, and the status/direction collision",
    status: "done",
    body: "Fill confirmations on Radix Toast. The design problem was not the component: a fill carries a STATUS and a DIRECTION, and both want the colour. Green means LONG here, so a green “Filled” on a short fill states the opposite of the truth.",
    detail: [
      "Split by job — the toast container carries status only, and direction lives in the body as a Side badge, which always prints the word",
      "There is deliberately no buy/sell toast intent; a completed fill is `neutral`, not `success`, because --color-success aliases the long green",
      "Rejections keep their glyph: a failure is not a direction, and the triangle carries it without hue",
      "The visible stack is capped at four — a market order against a thin book fills in partials and an uncapped queue buries the market bar",
      "Radix keeps a toast mounted while its exit animation runs, so dismissal is not a race between a timer and a transition",
      "Found and fixed: Dialog's `animate-in fade-in` were tailwindcss-animate classes with no plugin installed — dead CSS behind a green build",
    ],
  },
  {
    phase: "11",
    title: "Global header and landing page",
    status: "done",
    body: "Deposit and the account menu moved out of the market bar, which had been holding account-level actions only because it was the sole piece of top chrome. The terminal's fixed-viewport contract survived the extra 56px row.",
    detail: [
      "Radix DropdownMenu for the account menu — items style off data-highlighted, so arrowing looks identical to mousing",
      "The margin used/free Seam appears inside the menu: repetition is what makes a signature one",
      "Header is a hard h-(--size-header) shrink-0 row inside the h-dvh column — no min-height, or short laptops grow a page scrollbar again",
      "Landing page is the only route allowed the display type scale, and is deliberately static: the feed falls back to a simulator, and a marketing page quietly showing invented prices is worse than one showing none",
    ],
  },
  {
    phase: "12",
    title: "Review pass — the two things that were wrong",
    status: "done",
    body: "Both reported from looking at the built screen, and both were real. One was a composition bug in CSS that no build could have caught; the other was a design failure that a contrast measurement turned into a number.",
    detail: [
      "Dialogs jittered on open and close: Tailwind v4 compiles -translate-x-1/2 to the INDEPENDENT `translate` property, not `transform`. The keyframe also said translate(-50%,-50%), and since CSS applies `translate` before `transform`, the whole animation ran at -100%/-100% and snapped into place when it ended",
      "Fix: keyframes animate `transform` only and never restate the centring — scale composes cleanly, translate does not. Measured after: 0px of centre drift across the entrance and every scrub point of the exit",
      "Toasts were going unnoticed. Measured: surface-overlay against the panel behind it is 1.06:1 — for practical purposes the same colour, and shadow cannot rescue it on near-black where elevation is carried by lightness",
      "Fix: a dedicated surface-toast at the top of the elevation ladder (1.24:1), border-strong, shadow-e4, and a grey stripe on the neutral intent so a fill has the same anatomy as every other toast",
      "The entrance now carries the attention rather than the position: a short travel, then TWO luminance ticks peaking at 1.70:1 before cooling to rest over 560ms — a repeated signal reads as deliberate where one can be mistaken for a repaint, and the eye catches the second even if it missed the arrival",
      "Runs `linear` so the keyframe percentages are a rhythm rather than an ease curve; only the travel segment keeps ease-out-quart, via a per-keyframe animation-timing-function",
      "Toasts moved from bottom-right to top-right, offset by --size-header. Bottom-right was dead space diagonally opposite the dialog the user had just dismissed; docking at top-0 would have covered the Deposit button and account menu, so it clears the header and covers the ambient market bar instead",
      "The stack is flex-col-reverse: newest nearest the docked edge, so an expiring toast is removed from the far end and nothing above it shifts",
    ],
  },
  {
    phase: "13",
    title: "Backend integration",
    status: "next",
    body: "Replace the five placeholder modules with a real API client: markets, candles, account balances, the account tables and the order submit path. Fills arrive over the private ws-server channel rather than the local stand-in that fires them today.",
  },
];

/** Known-open items. Recorded rather than quietly carried. */
export const openQuestions: { title: string; body: string }[] = [
  {
    title: "No private websocket channel",
    body: "The ws-server broadcasts public market data only, keyed by market. Fill notifications and order-status updates have no push path, so the UI would have to poll REST after submitting an order. A per-user channel is agreed but not built; Phase 3 onward assumes push, not polling. This is the largest open item before integration.",
  },
  {
    title: "Account state is duplicated",
    body: "A hardcoded balance of 2521 appeared in the order ticket, the deposit dialog and the balances table, with two other figures elsewhere — four surfaces, four numbers. Resolved: `AccountProvider` in lib/account.tsx now owns one snapshot from GET /equity/balances, and every surface reads it. Equity is available + locked, summed as decimal strings rather than floats.",
  },
  {
    title: "Mobile is verified analytically, not visually",
    body: "The layout has been checked for page-level overflow and min-width overruns by measuring the DOM, but never actually viewed at a phone width — window resizing is not available in this environment. Worth confirming in DevTools device mode before more layout work lands on top of it.",
  },
];

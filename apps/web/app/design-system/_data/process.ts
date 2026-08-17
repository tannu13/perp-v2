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
    id: "inset-darker",
    title: "Inputs are recessed, not raised",
    choice: "--color-surface-inset sits below the canvas",
    rationale:
      "On dark, a lighter input on a dark panel reads as a floating card. Going darker is what makes a field read as something you type into.",
    tradeoff:
      "Inverts the usual light-theme instinct, so it consistently surprises people until they see it in place.",
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
    title: "Layouts and patterns",
    status: "next",
    body: "OrderBook, TradesFeed, DataTable, OrderForm and the responsive terminal shell across all three targets.",
  },
];

/** Known-open items. Recorded rather than quietly carried. */
export const openQuestions: { title: string; body: string }[] = [
  {
    title: "No private websocket channel",
    body: "The ws-server broadcasts public market data only, keyed by market. Fill notifications and order-status updates have no push path, so the UI has to poll REST after submitting an order. Either add a per-user channel server-side or accept optimistic UI plus reconciliation. This is the largest open item before Phase 3, because it decides whether the positions and orders tabs are push- or poll-driven.",
  },
  {
    title: "Depth-bar orientation is still hue-only",
    body: "Delta and Side now carry direction without color, but the order book's own bid/ask fills do not — a green bar and a red bar differ only in hue. Bar growth direction (bids fill right-to-left, asks left-to-right) is the conventional non-chromatic cue and should be built into the OrderBook component in Phase 3 rather than added afterwards.",
  },
  {
    title: "Tooltip cannot collide-detect",
    body: "The CSS-only tooltip has no portal and no flip logic, which is the right trade for labelling terminal chrome well inside the viewport. Anything needing real placement — a chart crosshair readout, a nested menu — will need a positioning library. Worth deciding when the chart lands, not before.",
  },
];

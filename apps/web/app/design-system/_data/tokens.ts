/**
 * Metadata for the living styleguide.
 *
 * Deliberately stores only NAMES and RATIONALE — never hex values. Every swatch
 * renders through `var(--token)` and reports its resolved value by reading
 * computed style at runtime, so this file can never drift out of sync with
 * tokens.css. If a token changes there, these docs change with it.
 */

export type ColorToken = {
  /** CSS custom property, without the leading `--`. */
  varName: string;
  /** Which Layer 1 primitive it points at — the indirection made visible. */
  resolves: string;
  /** What it is for. Written as guidance, not description. */
  usage: string;
  /** Relative bar fill, echoing the order book's depth rows. 0–100. */
  fill: number;
};

export type ColorGroup = {
  id: string;
  title: string;
  note: string;
  tokens: ColorToken[];
};

export const colorGroups: ColorGroup[] = [
  {
    id: "surfaces",
    title: "Surfaces",
    note: "On a near-black ground, shadow barely registers — elevation reads through background lightness plus a hairline border. Inputs sit ABOVE the panel, not below: the first pass recessed them and they vanished into the page, which is also why every comparable terminal raises them. surface-inset is now reserved for things that genuinely are recessed — slider grooves, table headers, meter tracks. Toasts sit at the very top: at surface-overlay a fill confirmation measured 1.06:1 against the panel behind it — the same colour, for practical purposes — and was reported as unnoticeable. At surface-toast it is 1.24:1, and the arrival flash peaks at 1.70:1.",
    tokens: [
      { varName: "color-surface-base", resolves: "neutral-950", usage: "App canvas", fill: 100 },
      { varName: "color-surface-raised", resolves: "neutral-900", usage: "Panels, cards, rails", fill: 82 },
      { varName: "color-surface-input", resolves: "literal", usage: "Text fields — raised above the panel", fill: 70 },
      { varName: "color-surface-overlay", resolves: "neutral-850", usage: "Dropdowns, popovers", fill: 64 },
      { varName: "color-surface-modal", resolves: "neutral-800", usage: "Dialogs, bottom sheets", fill: 48 },
      { varName: "color-surface-toast", resolves: "neutral-750", usage: "Toasts — the top of the ladder", fill: 42 },
      { varName: "color-surface-toast-flash", resolves: "literal", usage: "Brighter step a toast settles down from on arrival", fill: 40 },
      { varName: "color-surface-inset", resolves: "literal", usage: "Slider grooves, table headers", fill: 36 },
      { varName: "color-surface-hover", resolves: "white 4%", usage: "Row and control hover", fill: 22 },
      { varName: "color-surface-active", resolves: "white 8%", usage: "Pressed state", fill: 16 },
      { varName: "color-surface-selected", resolves: "primary 12%", usage: "Active tab, chosen row", fill: 10 },
    ],
  },
  {
    id: "text",
    title: "Text",
    note: "Four steps, hard stop. A fifth always ends up indistinguishable from the fourth in practice, and only gives people a decision they can get wrong.",
    tokens: [
      { varName: "color-text-primary", resolves: "neutral-100", usage: "Prices, values, headings", fill: 100 },
      { varName: "color-text-secondary", resolves: "neutral-300", usage: "Supporting copy, sizes", fill: 74 },
      { varName: "color-text-tertiary", resolves: "neutral-400", usage: "Column headers, labels", fill: 52 },
      { varName: "color-text-disabled", resolves: "neutral-500", usage: "Inactive controls", fill: 32 },
      { varName: "color-text-inverse", resolves: "neutral-950", usage: "On filled buy / primary", fill: 20 },
      { varName: "color-text-link", resolves: "primary-400", usage: "Inline links", fill: 14 },
    ],
  },
  {
    id: "directional",
    title: "Directional",
    note: "The most-repeated colors in the product. `buy` is the fill for solid controls; `buy-text` is the lighter step used for green type on dark ground, because the fill green fails contrast at 11px. The depth pair is separate from `muted` because muted-strong is shared with the Buy/Sell segmented control — widening the gap there to separate the two book bars would have made the order ticket loud again.",
    tokens: [
      { varName: "color-buy", resolves: "long-500", usage: "Solid fill — buy button, bid bar", fill: 100 },
      { varName: "color-buy-text", resolves: "long-400", usage: "Green type on dark", fill: 80 },
      { varName: "color-buy-muted", resolves: "long 14%", usage: "Generic tint", fill: 60 },
      { varName: "color-buy-depth-total", resolves: "long 13%", usage: "Order book — cumulative depth, the rear bar", fill: 50 },
      { varName: "color-buy-depth-level", resolves: "long 32%", usage: "Order book — this level's own size, front bar", fill: 40 },
      { varName: "color-sell", resolves: "short-500", usage: "Solid fill — sell button, ask bar", fill: 100 },
      { varName: "color-sell-text", resolves: "short-400", usage: "Red type on dark", fill: 80 },
      { varName: "color-sell-muted", resolves: "short 14%", usage: "Generic tint", fill: 60 },
      { varName: "color-sell-depth-total", resolves: "short 13%", usage: "Order book — cumulative depth, the rear bar", fill: 50 },
      { varName: "color-sell-depth-level", resolves: "short 32%", usage: "Order book — this level's own size, front bar", fill: 40 },
    ],
  },
  {
    id: "interactive",
    title: "Interactive",
    note: "Deliberately blue, not the buy green. If the confirm button, the active tab and a long position all shared one hue, green would stop meaning direction.",
    tokens: [
      { varName: "color-interactive", resolves: "primary-500", usage: "Primary CTA, active tab", fill: 100 },
      { varName: "color-interactive-hover", resolves: "primary-400", usage: "Hover", fill: 74 },
      { varName: "color-interactive-active", resolves: "primary-600", usage: "Pressed", fill: 52 },
      { varName: "color-interactive-muted", resolves: "primary 12%", usage: "Selected background", fill: 30 },
    ],
  },
  {
    id: "health",
    title: "Margin health",
    note: "A dedicated ramp for liquidation proximity. Kept separate from feedback colors on purpose — a healthy account should never share a token with a success toast, or the two drift apart the moment either is retuned.",
    tokens: [
      { varName: "color-health-safe", resolves: "long-500", usage: "Margin ratio comfortable", fill: 100 },
      { varName: "color-health-caution", resolves: "warning-500", usage: "Approaching maintenance", fill: 70 },
      { varName: "color-health-risk", resolves: "literal", usage: "Reduce or add margin", fill: 45 },
      { varName: "color-health-critical", resolves: "danger-500", usage: "Liquidation imminent", fill: 22 },
    ],
  },
  {
    id: "borders",
    title: "Borders",
    note: "Subtle must nearly disappear — it separates table rows. Strong must be findable without being loud — it outlines inputs.",
    tokens: [
      { varName: "color-border-subtle", resolves: "neutral-800", usage: "Table rows, panel splits", fill: 100 },
      { varName: "color-border-default", resolves: "neutral-700", usage: "Panel outlines, dividers", fill: 70 },
      { varName: "color-border-strong", resolves: "neutral-600", usage: "Input outlines", fill: 46 },
      { varName: "color-border-focus", resolves: "primary-500", usage: "Keyboard focus", fill: 26 },
      { varName: "color-border-error", resolves: "danger-500", usage: "Validation failure", fill: 14 },
    ],
  },
];

/** Layer 1 ramps, rendered straight from the primitives. */
export const ramps: { label: string; prefix: string; steps: string[] }[] = [
  {
    label: "neutral · the backbone",
    prefix: "color-neutral",
    steps: ["950", "900", "850", "800", "750", "700", "600", "500", "400", "300", "200", "100", "50"],
  },
  { label: "primary · interactive", prefix: "color-primary", steps: ["300", "400", "500", "600", "700"] },
  { label: "long · buy", prefix: "color-long", steps: ["300", "400", "500", "600", "700"] },
  { label: "short · sell", prefix: "color-short", steps: ["300", "400", "500", "600", "700"] },
  { label: "secondary · accent", prefix: "color-secondary", steps: ["300", "400", "500", "600"] },
];

export type TypeToken = {
  /** The generated Tailwind class — the specimen renders through the real token. */
  className: string;
  name: string;
  spec: string;
  sample: string;
  note?: string;
  tabular?: boolean;
  uppercase?: boolean;
  tone?: string;
};

export const typeScale: TypeToken[] = [
  { className: "text-display-lg", name: "display-lg", spec: "48 / 1.08 / −0.03em · 600", sample: "Trade perpetuals", note: "Marketing only" },
  { className: "text-display-md", name: "display-md", spec: "36 / 1.14 / −0.025em · 600", sample: "Sub-millisecond matching" },
  { className: "text-heading-lg", name: "heading-lg", spec: "28 / 1.2 / −0.02em · 600", sample: "Portfolio overview" },
  { className: "text-heading-md", name: "heading-md", spec: "22 / 1.26 / −0.015em · 600", sample: "Open positions" },
  { className: "text-heading-sm", name: "heading-sm", spec: "18 / 1.33 / −0.01em · 600", sample: "Cross margin overview" },
  { className: "text-body-lg", name: "body-lg", spec: "16 / 1.5 / 0 · 400", sample: "Deposit collateral to begin trading with leverage." },
  { className: "text-body-md", name: "body-md", spec: "14 / 1.45 / 0 · 400", sample: "Your order will rest on the book until filled or cancelled.", note: "App default" },
  { className: "text-body-sm", name: "body-sm", spec: "13 / 1.4 / 0 · 400", sample: "Limit order · SOL-USD · reduce only", note: "Table workhorse" },
  { className: "text-caption", name: "caption", spec: "12 / 1.35 / 0.005em · 400", sample: "Estimated liquidation price updates as margin changes." },
  { className: "text-micro", name: "micro", spec: "11 / 1.3 / 0.04em · 500", sample: "Price (USD) · Size (SOL) · Total", uppercase: true, tone: "text-text-tertiary" },
  { className: "text-num-xl", name: "num-xl", spec: "24 / 1.16 / −0.015em · 600", sample: "205.09", tabular: true, tone: "text-buy-text", note: "Header last price" },
  { className: "text-num-lg", name: "num-lg", spec: "20 / 1.2 / −0.01em · 600", sample: "18,485,368.61", tabular: true },
  { className: "text-num-md", name: "num-md", spec: "14 / 1.36 / 0 · 500", sample: "204.96   245.09   289.14", tabular: true, note: "Book rows. Coloured cells drop to 400" },
  { className: "text-num-sm", name: "num-sm", spec: "13 / 1.33 / 0 · 500", sample: "+4.96   +2.48%   00:25:50", tabular: true, tone: "text-text-secondary" },
];

export const spacingScale: { step: string; px: number }[] = [
  { step: "0.5", px: 2 },
  { step: "1", px: 4 },
  { step: "1.5", px: 6 },
  { step: "2", px: 8 },
  { step: "3", px: 12 },
  { step: "4", px: 16 },
  { step: "5", px: 20 },
  { step: "6", px: 24 },
  { step: "8", px: 32 },
  { step: "10", px: 40 },
  { step: "12", px: 48 },
  { step: "16", px: 64 },
];

export const layoutConstants: { token: string; value: string; applies: string }[] = [
  { token: "--size-header", value: "56px", applies: "Global top nav" },
  { token: "--size-market-bar", value: "64px", applies: "Ticker / stats strip" },
  { token: "--size-order-form", value: "320px", applies: "Right rail at lg; 344px at xl" },
  { token: "--size-orderbook", value: "288px", applies: "Book column; 320px at xl" },
  { token: "--size-row", value: "26px", applies: "Order-book / trades row — sets book density" },
  { token: "--size-control-md", value: "36px", applies: "Default input / button height" },
  { token: "--size-control-lg", value: "44px", applies: "Mobile minimum touch target" },
  { token: "--size-bottom-nav", value: "56px", applies: "Mobile tab bar only" },
];

export const radii: { name: string; css: string; usage: string }[] = [
  { name: "none", css: "0px", usage: "Tables" },
  { name: "xs", css: "3px", usage: "Depth bars" },
  { name: "sm", css: "4px", usage: "Tags, pills" },
  { name: "md", css: "6px", usage: "Controls" },
  { name: "lg", css: "8px", usage: "Panels" },
  { name: "xl", css: "12px", usage: "Modals" },
  { name: "full", css: "9999px", usage: "Avatars, toggles" },
];

export const elevations: { name: string; shadow: string; surface: string; usage: string }[] = [
  { name: "e0", shadow: "shadow-e0", surface: "bg-surface-base", usage: "Flush · canvas" },
  { name: "e1", shadow: "shadow-e1", surface: "bg-surface-raised", usage: "Cards, panels" },
  { name: "e2", shadow: "shadow-e2", surface: "bg-surface-overlay", usage: "Dropdowns" },
  { name: "e3", shadow: "shadow-e3", surface: "bg-surface-modal", usage: "Modals" },
  { name: "e4", shadow: "shadow-e4", surface: "bg-neutral-750", usage: "Command palette" },
];

export const rings: { name: string; shadow: string; usage: string }[] = [
  { name: "focus", shadow: "shadow-focus", usage: "Keyboard focus" },
  { name: "focus-error", shadow: "shadow-focus-error", usage: "Invalid input" },
  { name: "glow-buy", shadow: "shadow-glow-buy", usage: "Armed buy CTA" },
  { name: "glow-sell", shadow: "shadow-glow-sell", usage: "Armed sell CTA" },
];

export const motion: { token: string; value: string; applies: string }[] = [
  { token: "--duration-instant", value: "80ms", applies: "Color and opacity on press" },
  { token: "--duration-fast", value: "120ms", applies: "Hover, focus, tab switch" },
  { token: "--duration-base", value: "180ms", applies: "Dropdowns, tooltips, accordions" },
  { token: "--duration-slow", value: "260ms", applies: "Modals, mobile bottom sheet" },
  { token: "--ease-out-quart", value: "0.25, 1, 0.5, 1", applies: "Default — entrances" },
  { token: "--ease-in-out-quart", value: "0.76, 0, 0.24, 1", applies: "Between two anchored states" },
  { token: "--ease-spring", value: "0.34, 1.56, 0.64, 1", applies: "Toggles, sliders — slight overshoot" },
];

/**
 * Named animations.
 *
 * These are declared as `--animate-*` tokens rather than written inline for a
 * reason with a scar attached: Dialog previously carried `animate-in fade-in`,
 * which are tailwindcss-animate plugin classes. That plugin is not installed,
 * so both compiled to nothing and every dialog hard-cut into view — through a
 * green build, for weeks. A token cannot fail that quietly.
 */
export const animations: { token: string; value: string; applies: string }[] = [
  { token: "--animate-shimmer", value: "1.6s linear infinite", applies: "Skeleton sweep — the only looping animation in the app" },
  { token: "--animate-overlay-in / -out", value: "base / fast", applies: "Dialog and sheet scrims" },
  { token: "--animate-dialog-in / -out", value: "base / fast", applies: "Centred modal — scales from 0.97; animates transform ONLY, never translate" },
  { token: "--animate-sheet-in / -out", value: "slow / base", applies: "Mobile bottom sheet — the one surface allowed a full-height travel" },
  { token: "--animate-menu-in / -out", value: "fast / instant", applies: "Dropdown menus, from the edge Radix placed them against" },
  { token: "--animate-toast-in / -out", value: "560ms linear / fast", applies: "Desktop toast — short travel, then two luminance ticks that cool to rest" },
  { token: "--animate-toast-in-mobile", value: "560ms linear", applies: "Mobile toast, arriving downward from the top" },
  { token: "--animate-flash-buy / -sell", value: "400ms", applies: "Price-tick flash on an order-book level" },
];

export const breakpoints: { name: string; range: string; behaviour: string; cols: { flex: number; label: string; tone: string }[] }[] = [
  {
    name: "base",
    range: "< 768",
    behaviour:
      "Single column. Order form promotes to a bottom sheet; book, chart and trades become tabs; 56px bottom nav; all touch targets ≥ 44px.",
    cols: [{ flex: 1, label: "chart / book / form — tab-switched", tone: "bg-interactive-muted" }],
  },
  {
    name: "md",
    range: "768 – 1023",
    behaviour: "Transitional. Chart and book share a row, order form still a sheet.",
    cols: [
      { flex: 1.6, label: "chart", tone: "bg-interactive-muted" },
      { flex: 1, label: "book", tone: "bg-buy-muted" },
    ],
  },
  {
    name: "lg",
    range: "1024 – 1439",
    behaviour: "Three columns appear. Order form docks to a 320px right rail; bottom tabs scroll horizontally.",
    cols: [
      { flex: 2.4, label: "chart", tone: "bg-interactive-muted" },
      { flex: 1, label: "book", tone: "bg-buy-muted" },
      { flex: 1.1, label: "order form", tone: "bg-secondary-500/12" },
    ],
  },
  {
    name: "xl",
    range: "1440 – 1919",
    behaviour: "Full terminal. 344px form, 320px book, bottom tab panel always visible.",
    cols: [
      { flex: 3.2, label: "chart + bottom tabs", tone: "bg-interactive-muted" },
      { flex: 1, label: "book / trades", tone: "bg-buy-muted" },
      { flex: 1.1, label: "order form", tone: "bg-secondary-500/12" },
    ],
  },
  {
    name: "2xl",
    range: "≥ 1920",
    behaviour:
      "Content caps and centers; book widens to show cumulative totals rather than stretching the chart indefinitely.",
    cols: [
      { flex: 3.6, label: "chart + persistent tabs", tone: "bg-interactive-muted" },
      { flex: 1.15, label: "book / trades", tone: "bg-buy-muted" },
      { flex: 1.1, label: "order form", tone: "bg-secondary-500/12" },
    ],
  },
];

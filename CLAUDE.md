# perp-v2

Event-driven perpetual futures exchange. Backend services are Bun + Redis Streams
around a single in-memory matching engine; `apps/web` is the Next.js frontend.

## Layout

```
apps/backend        REST API (:3000)  → pushes to Redis streams
apps/engine         single-instance in-memory matching engine
apps/db-writer      idempotent consumer → Postgres
apps/ws-server      market-data broadcast (:3010)
apps/price-poller   Binance spot feed → engine
apps/scheduler      BullMQ cron (snapshots, funding)
apps/web            Next.js App Router frontend (:3020)
packages/shared     zod schemas + redis event types
packages/db         drizzle schema
```

## Frontend rules

Read these before writing any UI. The living reference is the app itself:
`/design-system` (tokens + build log) and `/design-system/components` (atoms).

### Tokens — `apps/web/app/styles/tokens.css`

- **Two layers.** Layer 1 primitives (`--color-long-500`) are never referenced in
  JSX. Components use Layer 2 semantics only (`--color-buy`, `bg-surface-raised`).
  A theme swap must stay a one-file edit.
- **`@theme static` is load-bearing.** Plain `@theme` tree-shakes any variable no
  utility class references, which silently breaks tokens read via `var()` in
  inline styles or third-party config. Do not change it back.
- **Never hardcode a color, size, radius or duration.** If a value is missing,
  add a token — don't inline it.
- **Dark-only.** Light theme is deferred and must remain a Layer 2 remap.

### Components — `apps/web/components/ui/`

- **CVA for variants, `cn()` for merging.** `cn()` is configured in
  `apps/web/lib/cn.ts` and *must* know the custom type scale — stock
  `tailwind-merge` cannot tell `text-body-md` (size) from `text-buy-text`
  (color) and silently drops one. Adding a `--text-*` token means updating
  `FONT_SIZES` there.
- **Native elements underneath.** Real `input`/`select`/`checkbox`, styled with
  `peer` + `appearance-none`. Keyboard, form participation and mobile pickers
  come free and correct.
- **Six states on every interactive atom:** default, hover, focus, active,
  disabled, error.
- **`Field` owns accessibility wiring** — label binding, `aria-describedby` for
  hint and error, `aria-invalid`. Inputs must not re-implement it.
- **Money is strings, never floats.** The backend sends prices and sizes as
  strings; keep them that way. `NumericInput` is deliberately `type="text"`.

### Direction and color

- **Green means LONG. Red means SHORT. Nothing else.** The primary CTA is blue
  (`--color-interactive`) precisely so green never reads as "confirm".
- **Colour must never be the only carrier of direction** — ~8% of men cannot
  separate the pair. `Delta` always renders a sign and `Side` always renders a
  word; those are not optional props. New directional surfaces need a
  non-chromatic cue too (sign, label, or bar orientation).
- `--color-buy` is for fills; `--color-buy-text` is the lighter step for green
  type on dark, which the fill green fails contrast for at 11px.

### The signature — `Seam`

Perps are opposing pressure held in balance. Wherever two opposing quantities
meet (bids/asks, long/short OI, margin used/free), use `Seam`: they grow toward
each other and meet at a join whose position *is* the ratio, with the
equilibrium value sitting on the join. Use it instead of inventing new ratio
bars — the repetition is what makes it a signature.

### Typography

IBM Plex Sans + IBM Plex Mono, chosen as a superfamily because mono and sans sit
adjacent inside the same table row and must stay optically aligned. Plex Sans has
tabular digits by default; `.tnum` remains a safety net. Mono is restricted to
order ids, hashes and API keys, and carries a slashed zero.

### Third-party components

Build atoms in-house. Use **shadcn/Radix for behaviour-heavy overlays only** —
Dialog, Popover, DropdownMenu, Tooltip — where focus trapping, scroll lock,
`inert` backgrounds and return-focus-on-close are easy to get subtly wrong.
shadcn copies source in, so our tokens still drive all styling.

## Verification discipline

A green build is not proof. Two silent failures got through it already:
`--duration-*` has no Tailwind namespace (variables defined, no classes emitted),
and plain `@theme` tree-shook two tokens out of `:root`.

- After token changes, grep the compiled CSS for the utilities, and check the
  resolved values **in the browser**, not just the build output.
- Never run `bun run build` while `bun run dev` is running — they share `.next/`
  and the build wipes the dev server's manifests.
- CSS transitions do not advance in a throttled background tab; a computed color
  read there can be a frozen mid-transition value, not a bug.

## Commands

```bash
bun install
bun run dev                       # all services via turbo
cd apps/web && bun run dev        # frontend only, :3020
cd apps/web && bun run check-types
cd apps/web && bun run build
```

"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { DEFAULT_MARKET } from "@/lib/markets";
import {
  Avatar,
  Badge,
  Button,
  buttonVariants,
  Checkbox,
  Delta,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuMeta,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LeverageSlider,
  Num,
  NumericInput,
  Radio,
  ScrollArea,
  SearchInput,
  SegmentedControl,
  Select,
  Seam,
  SeamRule,
  Side,
  Skeleton,
  SkeletonRows,
  SkeletonTable,
  SkeletonText,
  StatusDot,
  Tag,
  Textarea,
  TextLink,
  Toggle,
  Tooltip,
  useToast,
  ChevronDownIcon,
  CloseIcon,
  LayersIcon,
  ListIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  WalletIcon,
} from "@/components/ui";
import { fillToastOptions } from "@/components/terminal/fill-toast";
import { SiteHeader } from "@/components/chrome/site-header";
import { Callout, Note, Panel, Section, SubHead } from "../_components/ui";

/* --------------------------------------------------------------- helpers -- */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-border-subtle px-4 py-3 last:border-b-0 md:grid-cols-[132px_minmax(0,1fr)] md:items-center md:gap-5">
      <div className="font-mono text-micro uppercase text-text-tertiary">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}

export default function ComponentsPage() {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState("204.96");
  const [qty, setQty] = useState("4.74");
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [margin, setMargin] = useState(true);
  const [tif, setTif] = useState("gtc");
  const [leverage, setLeverage] = useState(5);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { toast } = useToast();

  const notional = (Number(price) || 0) * (Number(qty) || 0);

  return (
    <>
      <SiteHeader />
      <div className="mx-auto max-w-[1100px] px-5 pb-24 lg:px-8">
      {/* ------------------------------------------------------- masthead -- */}
      <header className="mb-10 border-b border-border-subtle pt-10 pb-10">
        <div className="mb-4 flex flex-wrap items-center gap-2.5 font-mono text-micro uppercase text-text-tertiary">
          <StatusDot intent="online" label="Component library" />
          Perp v2 · Component library
        </div>
        <h1 className="mb-3.5 text-balance text-display-md text-text-primary">
          Component library
        </h1>
        <p className="max-w-[62ch] text-body-lg leading-relaxed text-text-secondary">
          Atoms built from the Phase 1 tokens, with variants typed through CVA.
          Every control below is live — hover, tab and click them. Nothing here
          hardcodes a color or a size.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <TextLink href="/design-system">← Tokens &amp; build log</TextLink>
          <TextLink href="/" intent="subtle">
            Home
          </TextLink>
        </div>
      </header>

      {/* ---------------------------------------------------------- state -- */}
      <Section
        id="states"
        num="01"
        title="The state matrix"
        note="6 states per control"
      >
        <Note>
          Every interactive atom implements the same six states. Disabled, error
          and loading are rendered statically below; hover, focus and active are
          live, so use a mouse and the Tab key to exercise them.
        </Note>

        <Panel>
          <Row label="Default">
            <Button intent="primary">Place order</Button>
            <Button intent="neutral">Cancel</Button>
          </Row>
          <Row label="Hover · live">
            <Button intent="primary">Hover me</Button>
            <span className="text-caption text-text-tertiary">
              Background steps to the 400 tint over 120ms.
            </span>
          </Row>
          <Row label="Focus · live">
            <Button intent="primary">Tab to me</Button>
            <span className="text-caption text-text-tertiary">
              Ring is <code className="font-mono">shadow-focus</code>, not the
              browser default.
            </span>
          </Row>
          <Row label="Active · live">
            <Button intent="primary">Hold me down</Button>
          </Row>
          <Row label="Disabled">
            <Button intent="primary" disabled>
              Place order
            </Button>
            <Button intent="buy" disabled>
              Buy
            </Button>
            <Button intent="neutral" disabled>
              Cancel
            </Button>
          </Row>
          <Row label="Loading">
            <Button intent="primary" loading>
              Submitting
            </Button>
            <Button intent="buy" loading>
              Buying
            </Button>
          </Row>
          <Row label="Error">
            <div className="w-64">
              <Field label="Limit price" error="Price must be above 0.">
                <Input defaultValue="0" numeric />
              </Field>
            </div>
          </Row>
        </Panel>
      </Section>

      {/* -------------------------------------------------------- buttons -- */}
      <Section id="buttons" num="02" title="Buttons" note="6 intents · 3 sizes">
        <Note>
          Intent is semantic, never decorative. <b className="text-text-primary">primary</b>{" "}
          is the blue non-directional confirm;{" "}
          <b className="text-buy-text">buy</b> and{" "}
          <b className="text-sell-text">sell</b> are reserved for order actions
          and must never be used for a generic submit.
        </Note>

        <Panel>
          <Row label="primary">
            <Button intent="primary" size="sm">Small</Button>
            <Button intent="primary" size="md">Medium</Button>
            <Button intent="primary" size="lg">Large</Button>
          </Row>
          <Row label="buy">
            <Button intent="buy" size="sm">Buy</Button>
            <Button intent="buy" size="md">Buy / Long</Button>
            <Button intent="buy" size="lg">Buy SOL-USD</Button>
          </Row>
          <Row label="sell">
            <Button intent="sell" size="sm">Sell</Button>
            <Button intent="sell" size="md">Sell / Short</Button>
            <Button intent="sell" size="lg">Sell SOL-USD</Button>
          </Row>
          <Row label="neutral">
            <Button intent="neutral" size="sm">Cancel</Button>
            <Button intent="neutral" size="md">Cancel all</Button>
          </Row>
          <Row label="ghost">
            <Button intent="ghost" size="sm">Dismiss</Button>
            <Button intent="ghost" size="md">View details</Button>
          </Row>
          <Row label="danger">
            <Button intent="danger" size="md">Close position</Button>
            <span className="text-caption text-text-tertiary">
              Committed destructive action — use inside a confirm dialog.
            </span>
          </Row>
          <Row label="danger-ghost">
            <Button intent="danger-ghost" size="sm">Cancel</Button>
            <Button intent="danger-ghost" size="sm">Close</Button>
            <span className="text-caption text-text-tertiary">
              Row actions. Neutral at rest, red on hover — a table of solid red
              buttons is alarm fatigue.
            </span>
          </Row>
          <Row label="fullWidth">
            <div className="w-full max-w-sm">
              <Button intent="buy" size="lg" fullWidth>
                Buy 4.74 SOL
              </Button>
            </div>
          </Row>
          <Row label="Icon buttons">
            <IconButton label="Add"><PlusIcon /></IconButton>
            <IconButton label="Search" intent="neutral"><SearchIcon /></IconButton>
            <IconButton label="Close" intent="danger-ghost"><CloseIcon /></IconButton>
            <IconButton label="Add small" size="sm"><PlusIcon /></IconButton>
            <IconButton label="Add large" size="lg"><PlusIcon /></IconButton>
            <IconButton label="Disabled" disabled><PlusIcon /></IconButton>
          </Row>
          <Row label="Links">
            <TextLink href="#buttons">Primary link</TextLink>
            <TextLink href="#buttons" intent="subtle">Subtle link</TextLink>
            <TextLink href="#buttons" intent="inline">Inline link</TextLink>
          </Row>
        </Panel>
      </Section>

      {/* --------------------------------------------------------- inputs -- */}
      <Section id="inputs" num="03" title="Form inputs" note="Field handles a11y wiring">
        <Note>
          <code className="font-mono text-num-sm text-text-primary">Field</code>{" "}
          owns the id plumbing — label association,{" "}
          <code className="font-mono text-num-sm text-text-primary">aria-describedby</code>{" "}
          for hint and error, and{" "}
          <code className="font-mono text-num-sm text-text-primary">aria-invalid</code>{" "}
          — so no input re-implements it. Error replaces hint rather than
          stacking; two lines of guidance under one field is noise.
        </Note>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Panel className="p-4">
            <div className="flex flex-col gap-4">
              <Field label="Username" hint="Letters and numbers only.">
                <Input placeholder="satoshi" />
              </Field>
              <Field label="Password" error="Must be at least 8 characters." required>
                <Input type="password" defaultValue="short" />
              </Field>
              <Field label="Disabled">
                <Input placeholder="Unavailable" disabled />
              </Field>
              <Field label="Search">
                <SearchInput />
              </Field>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="flex flex-col gap-4">
              <Field label="Limit price" hint="Arrow keys nudge by the tick size.">
                <NumericInput
                  value={price}
                  onValueChange={setPrice}
                  step={0.01}
                  min={0}
                  suffix="USD"
                />
              </Field>
              <Field label="Quantity">
                <NumericInput
                  value={qty}
                  onValueChange={setQty}
                  step={0.1}
                  min={0}
                  suffix="SOL"
                />
              </Field>
              <Field label="Time in force">
                <Select value={tif} onChange={(e) => setTif(e.target.value)}>
                  <option value="gtc">Good til cancelled</option>
                  <option value="ioc">Immediate or cancel</option>
                  <option value="fok">Fill or kill</option>
                </Select>
              </Field>
              <Field label="Note" hint="Optional.">
                <Textarea placeholder="Internal note for this order" rows={3} />
              </Field>
            </div>
          </Panel>
        </div>

        <SubHead>Selection controls</SubHead>
        <Panel>
          <Row label="Checkbox">
            <Checkbox label="Post only" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
            <Checkbox label="Reduce only" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
            <Checkbox label="Indeterminate" indeterminate readOnly checked={false} />
            <Checkbox label="Disabled" disabled />
          </Row>
          <Row label="Radio">
            <Radio name="demo-radio" label="Cross margin" defaultChecked />
            <Radio name="demo-radio" label="Isolated margin" />
            <Radio name="demo-radio-2" label="Disabled" disabled />
          </Row>
          <Row label="Toggle">
            <Toggle label="Margin" checked={margin} onChange={(e) => setMargin(e.target.checked)} />
            <Toggle label="Small" size="sm" defaultChecked />
            <Toggle label="Disabled" disabled />
          </Row>
          <Row label="Segmented">
            <SegmentedControl
              aria-label="Order side"
              intent="directional"
              options={[
                { value: "buy", label: "Buy" },
                { value: "sell", label: "Sell" },
              ]}
              value={side}
              onValueChange={setSide}
            />
            <SegmentedControl
              aria-label="Order type"
              options={[
                { value: "limit", label: "Limit" },
                { value: "market", label: "Market" },
              ]}
              value={orderType}
              onValueChange={setOrderType}
            />
          </Row>
          <Row label="Leverage">
            <div className="w-full max-w-[300px]">
              <LeverageSlider
                value={leverage}
                onChange={setLeverage}
                max={10}
              />
            </div>
            <span className="max-w-[34ch] text-caption text-text-tertiary">
              A native <code className="font-mono">range</code> underneath, so
              arrow keys, Home/End and mobile drag come free. The readout climbs
              the margin-health ramp — grey, then amber, then red past 8x —
              because the number is the risk, not the track.
            </span>
          </Row>
        </Panel>
      </Section>

      {/* ------------------------------------------ indicators & overlays -- */}
      <Section
        id="indicators"
        num="04"
        title="Indicators &amp; overlays"
        note="badges · dots · Radix overlays"
      >
        <Panel>
          <Row label="Order status">
            <Badge intent="neutral">Pending</Badge>
            <Badge intent="info">Open</Badge>
            <Badge intent="warning">Partially filled</Badge>
            <Badge intent="outline">Filled</Badge>
            <Badge intent="neutral">Cancelled</Badge>
            <span className="text-caption text-text-tertiary">
              Non-directional intents only.
            </span>
          </Row>
          <Row label="Other badges">
            <Badge intent="danger">Liquidated</Badge>
            <Badge intent="outline">10x</Badge>
            <Badge intent="buy">Long</Badge>
            <Badge intent="sell">Short</Badge>
            <span className="text-caption text-text-tertiary">
              buy / sell are reserved for market direction — never for status.
            </span>
          </Row>
          <Row label="Tag">
            <Tag label="SOL-USD" />
            <Tag label="Open orders" onRemove={() => {}} />
            <Tag label="Last 24h" onRemove={() => {}} />
          </Row>
          <Row label="Status dot">
            <span className="flex items-center gap-1.5 text-body-sm text-text-secondary">
              <StatusDot intent="online" pulse label="Connected" /> Connected
            </span>
            <span className="flex items-center gap-1.5 text-body-sm text-text-secondary">
              <StatusDot intent="warning" label="Reconnecting" /> Reconnecting
            </span>
            <span className="flex items-center gap-1.5 text-body-sm text-text-secondary">
              <StatusDot intent="offline" label="Disconnected" /> Disconnected
            </span>
          </Row>
          <Row label="Avatar">
            <Avatar name="Tanuj Pant" size="sm" />
            <Avatar name="Tanuj Pant" />
            <Avatar name="Satoshi" size="lg" intent="accent" />
            <Avatar name="Perp Bot" intent="interactive" />
          </Row>
          <Row label="Scroll area">
            <ScrollArea className="h-24 w-56 rounded-md border border-border-subtle bg-surface-inset">
              <div className="flex flex-col gap-1 p-2">
                {Array.from({ length: 14 }, (_, i) => (
                  <span key={i} className="text-num-sm tnum text-text-secondary">
                    row {String(i + 1).padStart(2, "0")}
                  </span>
                ))}
              </div>
            </ScrollArea>
            <span className="max-w-[34ch] text-caption text-text-tertiary">
              The default for any scrollable region. Its scrollbar is an overlay
              and takes no layout width, so content cannot reflow when it appears
              — which is why raw overflow-y-auto is the exception here.
            </span>
          </Row>
          <Row label="Tooltip">
            <Tooltip content="Initial margin required to open">
              <span className="cursor-help border-b border-dashed border-border-strong text-body-sm text-text-secondary">
                Initial margin
              </span>
            </Tooltip>
            <Tooltip content="Opens on focus too — try tabbing" side="bottom">
              <Button intent="neutral" size="sm">Focus me</Button>
            </Tooltip>
          </Row>
          <Row label="Dropdown menu">
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  buttonVariants({ intent: "neutral", size: "sm" }),
                  "gap-1.5",
                )}
              >
                Open menu
                <ChevronDownIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuItem>
                  <WalletIcon className="size-4" />
                  Deposit
                  <DropdownMenuMeta>$14,380.72</DropdownMenuMeta>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <SettingsIcon className="size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem intent="danger">
                  <LogOutIcon className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="max-w-[36ch] text-caption text-text-tertiary">
              Arrow through it — items highlight identically for keyboard and
              pointer, because the style hangs off Radix&apos;s{" "}
              <code className="font-mono">data-highlighted</code>, not{" "}
              <code className="font-mono">:hover</code>.
            </span>
          </Row>
          <Row label="Dialog">
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger
                className={buttonVariants({ intent: "neutral", size: "sm" })}
              >
                Confirm dialog
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Close SOL-USD position?</DialogTitle>
                <DialogDescription>
                  This submits a market order for the full size. The fill price
                  depends on the book and will not exactly match the mark.
                </DialogDescription>
                <div className="flex gap-2 *:flex-1">
                  <DialogClose asChild>
                    <Button intent="neutral">Keep position</Button>
                  </DialogClose>
                  {/* Solid `danger` is legitimate here and only here: the action
                      is committed at this point and the dialog says what it
                      destroys. Row actions use `danger-ghost` instead. */}
                  <Button
                    intent="danger"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Close position
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
              <DialogTrigger
                className={buttonVariants({ intent: "neutral", size: "sm" })}
              >
                Centred (no sheet)
              </DialogTrigger>
              <DialogContent sheetOnMobile={false}>
                <DialogTitle>Centred at every width</DialogTitle>
                <DialogDescription>
                  The default promotes to a bottom sheet under{" "}
                  <code className="font-mono">md</code>, where a centred modal
                  fights the thumb. Narrow this window to see the difference
                  between the two triggers.
                </DialogDescription>
                <DialogClose asChild>
                  <Button intent="neutral">Close</Button>
                </DialogClose>
              </DialogContent>
            </Dialog>

            <span className="max-w-[38ch] text-caption text-text-tertiary">
              Focus is trapped and returned to the trigger, the background goes
              inert, body scroll locks, Escape and outside-click dismiss. The
              entrance animates <code className="font-mono">transform</code>{" "}
              only — restating the centring offset in the keyframe made it
              compose with Tailwind&apos;s{" "}
              <code className="font-mono">translate</code> and snap into place.
            </span>
          </Row>
        </Panel>
      </Section>

      {/* -------------------------------------------------------- absence -- */}
      <Section
        id="absence"
        num="05"
        title="Waiting and absence"
        note="skeleton · empty · error"
      >
        <Note>
          Three states that all look like &ldquo;nothing here&rdquo; and mean
          completely different things. The whole job of this group is to keep
          them distinguishable: a skeleton says data is coming, an empty state
          says there is none and this is normal, an error state says the request
          failed and here is what to do. At rest a skeleton block and an empty
          panel are the same rectangle — the sweep is the only difference, which
          is why it is a token rather than decoration.
        </Note>

        <SubHead>Skeletons</SubHead>
        <Panel>
          <Row label="Shapes">
            <Skeleton className="h-8 w-28" />
            <Skeleton shape="text" className="h-3 w-40" />
            <Skeleton shape="pill" className="h-5 w-16" />
            <Skeleton shape="circle" className="size-8" />
          </Row>
          <Row label="Text">
            <SkeletonText lines={3} className="w-full max-w-[320px]" />
          </Row>
          <Row label="Ladder">
            <div className="w-full max-w-[260px] rounded-md border border-border-subtle bg-surface-inset p-2">
              <SkeletonRows rows={6} columns={3} />
            </div>
            <span className="max-w-[34ch] text-caption text-text-tertiary">
              Rows are pinned to{" "}
              <code className="font-mono">--size-row</code>, the same token the
              real ladder uses, so nothing moves when the book arrives.
            </span>
          </Row>
          <Row label="Table">
            <div className="w-full overflow-hidden rounded-md border border-border-subtle">
              <SkeletonTable
                rows={3}
                columns={["Market", "Size", "Entry", "PnL"]}
              />
            </div>
          </Row>
        </Panel>

        <SubHead>Empty states</SubHead>
        <Panel>
          <Row label="In a table">
            <div className="w-full rounded-md border border-border-subtle bg-surface-inset">
              <EmptyState
                icon={LayersIcon}
                title="No open positions"
                description="A position opens here as soon as one of your orders fills."
              />
            </div>
          </Row>
          <Row label="With an action">
            <div className="w-full rounded-md border border-border-subtle bg-surface-inset">
              <EmptyState
                icon={WalletIcon}
                title="No collateral deposited"
                description="Deposit to fund your cross-margin account and start trading."
                action={
                  <Button intent="primary" size="md">
                    Deposit
                  </Button>
                }
              />
            </div>
          </Row>
          <Row label="Compact (sm)">
            <div className="w-full max-w-[260px] rounded-md border border-border-subtle bg-surface-inset">
              <EmptyState
                size="sm"
                icon={ListIcon}
                title="No prints yet"
                description="Trades appear here the moment the book crosses."
              />
            </div>
          </Row>
        </Panel>

        <SubHead>Error states</SubHead>
        <Panel>
          <Row label="With retry">
            <div className="w-full rounded-md border border-border-subtle bg-surface-inset">
              <ErrorState
                title="Couldn't load the order book"
                description="The market data socket did not respond. Your positions and orders are unaffected."
                detail="WebSocket 1006 — abnormal closure"
                onRetry={() => {}}
              />
            </div>
          </Row>
          <Row label="Compact (sm)">
            <div className="w-full max-w-[280px] rounded-md border border-border-subtle bg-surface-inset">
              <ErrorState
                size="sm"
                title="Couldn't load account"
                description="Your balances are unavailable."
                onRetry={() => {}}
              />
            </div>
          </Row>
        </Panel>

        <Callout tone="warn">
          The error state is <code className="font-mono">danger</code>, never{" "}
          <code className="font-mono">sell</code>. Red means SHORT everywhere
          else on this screen, so the triangle glyph and the word carry the
          meaning and the colour only reinforces it. Retry is{" "}
          <code className="font-mono">neutral</code> — solid danger is reserved
          for a committed destructive action inside a confirm dialog.
        </Callout>
      </Section>

      {/* -------------------------------------------------- notifications -- */}
      <Section
        id="toasts"
        num="06"
        title="Toasts"
        note="status ≠ direction"
      >
        <Note>
          Fill confirmations are the reason this system exists, and they are
          where the two colour rules collide: a fill has a status and a
          direction, and both want to own the colour. They are split by job —
          the toast container carries status only, and direction lives in the
          body as a <code className="font-mono">Side</code> badge, which always
          prints the word. Click through them; they stack, pause on hover, and
          can be swiped away.
        </Note>

        <Panel>
          <Row label="Fill · long">
            <Button
              intent="neutral"
              size="sm"
              onClick={() =>
                toast(
                  fillToastOptions({
                    orderId: "sol-usd-8f31c2a4",
                    side: "LONG",
                    status: "filled",
                    qty: "4.74",
                    price: "204.96",
                    market: DEFAULT_MARKET,
                  }),
                )
              }
            >
              Fire fill toast
            </Button>
            <span className="max-w-[36ch] text-caption text-text-tertiary">
              Neutral container, not{" "}
              <code className="font-mono">success</code> — the success token
              aliases the long green, so a green &ldquo;Filled&rdquo; on a SHORT
              fill would state the opposite of the truth.
            </span>
          </Row>
          <Row label="Fill · short">
            <Button
              intent="neutral"
              size="sm"
              onClick={() =>
                toast(
                  fillToastOptions({
                    orderId: "sol-usd-1d90bb7e",
                    side: "SHORT",
                    status: "filled",
                    qty: "12.50",
                    price: "205.41",
                    market: DEFAULT_MARKET,
                  }),
                )
              }
            >
              Fire fill toast
            </Button>
          </Row>
          <Row label="Partial">
            <Button
              intent="neutral"
              size="sm"
              onClick={() =>
                toast(
                  fillToastOptions({
                    orderId: "sol-usd-44ac10f2",
                    side: "LONG",
                    status: "partial",
                    qty: "1.20",
                    price: "204.88",
                    market: DEFAULT_MARKET,
                  }),
                )
              }
            >
              Fire partial
            </Button>
          </Row>
          <Row label="Rejected">
            <Button
              intent="neutral"
              size="sm"
              onClick={() =>
                toast(
                  fillToastOptions({
                    orderId: "sol-usd-0b7719de",
                    side: "SHORT",
                    status: "rejected",
                    qty: "80.00",
                    price: "0",
                    market: DEFAULT_MARKET,
                    reason: "insufficient margin",
                  }),
                )
              }
            >
              Fire rejection
            </Button>
            <span className="max-w-[36ch] text-caption text-text-tertiary">
              The one fill toast that keeps a glyph — a failure is not a
              direction, and the triangle carries it without hue.
            </span>
          </Row>
          <Row label="Status intents">
            {(["neutral", "info", "success", "warning", "danger"] as const).map(
              (intent) => (
                <Button
                  key={intent}
                  intent="neutral"
                  size="sm"
                  onClick={() =>
                    toast({
                      intent,
                      title: `${intent} toast`,
                      description:
                        "Non-directional only. There is no buy or sell intent here by design.",
                    })
                  }
                >
                  {intent}
                </Button>
              ),
            )}
          </Row>
          <Row label="With an action">
            <Button
              intent="neutral"
              size="sm"
              onClick={() =>
                toast({
                  intent: "info",
                  title: "Order cancelled",
                  description: "a1b2c3…0001 was cancelled before it filled.",
                  action: {
                    label: "Undo",
                    altText: "Open the orders tab to re-place this order",
                    onClick: () => {},
                  },
                })
              }
            >
              With action
            </Button>
            <span className="max-w-[36ch] text-caption text-text-tertiary">
              Radix requires alt text on an action: a screen-reader user cannot
              race the timeout, so it must describe a durable route to the same
              outcome.
            </span>
          </Row>
          <Row label="Burst · cap">
            <Button
              intent="neutral"
              size="sm"
              onClick={() => {
                for (let i = 0; i < 7; i++) {
                  toast({
                    intent: "neutral",
                    title: `Partial fill ${i + 1} of 7`,
                    description: "A market order against a thin book.",
                  });
                }
              }}
            >
              Fire seven
            </Button>
            <span className="max-w-[36ch] text-caption text-text-tertiary">
              Four stay on screen. A market order against a thin book fills in
              partials, and an uncapped queue buries the market bar.
            </span>
          </Row>
        </Panel>
      </Section>

      {/* ---------------------------------------------------- directional -- */}
      <Section
        id="directional"
        num="07"
        title="Directional numbers"
        note="answers the Phase 1 caveat"
      >
        <Note>
          This is where the colorblind risk flagged in Phase 1 gets resolved.{" "}
          <code className="font-mono text-num-sm text-text-primary">Delta</code>{" "}
          always renders an explicit sign and{" "}
          <code className="font-mono text-num-sm text-text-primary">Side</code>{" "}
          always renders a word, so direction survives with the color removed.
          The sign is not an option on the component — it cannot be turned off.
        </Note>

        <Panel>
          <Row label="Delta">
            <Delta value={4.96} />
            <Delta value={-2.31} />
            <Delta value={0} />
            <Delta value={2.48} percent />
            <Delta value={-0.14} percent />
            <Delta value={1284.5} unit="USD" size="lg" weight="bold" />
          </Row>
          <Row label="Side">
            <Side side="LONG" />
            <Side side="SHORT" />
            <Side side="LONG" size="sm" />
          </Row>
          <Row label="Num">
            <Num value={205.09} size="xl" />
            <Num value={18485368.61} size="lg" />
            <Num value="204.96" />
          </Row>
          <Row label="Grayscale">
            <div className="flex flex-wrap items-center gap-2.5 grayscale">
              <Delta value={4.96} percent />
              <Delta value={-2.31} percent />
              <Side side="LONG" />
              <Side side="SHORT" />
              <span className="text-caption text-text-tertiary">
                ← still readable with hue removed
              </span>
            </div>
          </Row>
        </Panel>
      </Section>

      {/* ------------------------------------------------------- signature -- */}
      <Section
        id="seam"
        num="08"
        title="The seam"
        note="signature primitive"
      >
        <Note>
          A perpetual future is opposing pressure held in balance — longs against
          shorts, tethered to spot by funding. The most characteristic moment in
          the product is the middle of the order book, where bids pressing up
          meet asks pressing down and the last price sits on the join.{" "}
          <code className="font-mono text-num-sm text-text-primary">Seam</code>{" "}
          generalises that moment: two quantities grow toward each other and meet
          at a point that <em>is</em> the ratio. Information, not ornament — the
          balance is readable before any number is.
        </Note>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel className="flex flex-col gap-5 p-4">
            <Seam
              left={67}
              right={33}
              value="205.09"
              leftLabel="Bids 67%"
              rightLabel="33% Asks"
            />
            <Seam
              left={1240}
              right={880}
              value="+0.0142%"
              leftLabel="Long OI"
              rightLabel="Short OI"
              size="lg"
            />
            <Seam
              left={19}
              right={81}
              value="19%"
              leftLabel="Margin used"
              rightLabel="Available"
              intent="neutral"
              size="sm"
            />
            <Seam left={50} right={50} value="—" leftLabel="Balanced" rightLabel="Balanced" />
          </Panel>

          <Panel className="p-3">
            <div className="mb-2 flex justify-between px-1.5 text-micro uppercase text-text-tertiary">
              <span>Price</span>
              <span>Size</span>
            </div>
            {[
              ["205.06", "41.48", 62],
              ["205.04", "12.20", 30],
              ["205.01", "41.48", 61],
            ].map(([p, s, f]) => (
              <div
                key={p as string}
                className="relative flex h-(--size-row) items-center justify-between px-1.5 text-num-md tnum"
              >
                <span
                  className="absolute inset-y-0 right-0 bg-sell-muted"
                  style={{ width: `${f}%` }}
                />
                <span className="relative text-sell-text">{p}</span>
                <span className="relative text-text-secondary">{s}</span>
              </div>
            ))}

            <SeamRule
              className="my-1"
              value="205.09"
              delta={<Delta value={2.48} percent size="sm" />}
            />

            {[
              ["205.00", "6.39", 12],
              ["204.98", "7.35", 18],
              ["204.96", "245.09", 88],
            ].map(([p, s, f]) => (
              <div
                key={p as string}
                className="relative flex h-(--size-row) items-center justify-between px-1.5 text-num-md tnum"
              >
                <span
                  className="absolute inset-y-0 right-0 bg-buy-muted"
                  style={{ width: `${f}%` }}
                />
                <span className="relative text-buy-text">{p}</span>
                <span className="relative text-text-secondary">{s}</span>
              </div>
            ))}

            <div className="mt-2 px-1.5">
              <Seam left={67} right={33} size="sm" leftLabel="67%" rightLabel="33%" />
            </div>
          </Panel>
        </div>
      </Section>

      {/* ------------------------------------------------------ composed --- */}
      <Section
        id="composed"
        num="09"
        title="Composed"
        note="atoms under load"
      >
        <Note>
          A real order ticket assembled only from the atoms above — no bespoke
          styles. This was the check that the primitives held together before
          anything was built on them; they did, and the organisms now exist.
          Three are on this page — the global header at the top, the ladder in{" "}
          <em>The seam</em>, and this ticket. The rest live in the terminal:{" "}
          <TextLink href="/trade/SOL-USD">market bar, order book, trades
          feed, chart and account tables</TextLink>.
        </Note>

        <div className="max-w-sm">
          <Panel className="p-4">
            <div className="flex flex-col gap-3.5">
              <SegmentedControl
                aria-label="Order side"
                intent="directional"
                fullWidth
                options={[
                  { value: "buy", label: "Buy" },
                  { value: "sell", label: "Sell" },
                ]}
                value={side}
                onValueChange={setSide}
              />

              <SegmentedControl
                aria-label="Order type"
                size="sm"
                fullWidth
                options={[
                  { value: "limit", label: "Limit" },
                  { value: "market", label: "Market" },
                ]}
                value={orderType}
                onValueChange={setOrderType}
              />

              <div className="flex items-center justify-between text-body-sm">
                <span className="text-text-tertiary">Balance</span>
                <Num value={2521.0} />
              </div>

              {orderType === "limit" && (
                <Field label="Limit price">
                  <NumericInput
                    value={price}
                    onValueChange={setPrice}
                    step={0.01}
                    min={0}
                    suffix="USD"
                  />
                </Field>
              )}

              <Field label="Quantity">
                <NumericInput
                  value={qty}
                  onValueChange={setQty}
                  step={0.1}
                  min={0}
                  suffix="SOL"
                />
              </Field>

              <div className="flex items-center justify-between border-t border-border-subtle pt-3 text-body-sm">
                <span className="text-text-tertiary">Order value</span>
                <Num value={notional} />
              </div>

              <Button
                intent={side === "buy" ? "buy" : "sell"}
                size="lg"
                fullWidth
              >
                {side === "buy" ? "Buy" : "Sell"} {qty || "0"} SOL
              </Button>

              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <Checkbox
                  label="Post only"
                  checked={postOnly}
                  onChange={(e) => setPostOnly(e.target.checked)}
                />
                <Checkbox
                  label="Reduce only"
                  checked={reduceOnly}
                  onChange={(e) => setReduceOnly(e.target.checked)}
                />
              </div>
            </div>
          </Panel>
        </div>
      </Section>

      <footer className="flex flex-wrap justify-between gap-3.5 border-t border-border-subtle pt-5 font-mono text-micro text-text-disabled">
        <span>apps/web/components/ui/</span>
        <Link href="/design-system" className="hover:text-text-secondary">
          Phase 1 tokens →
        </Link>
      </footer>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Delta,
  Field,
  IconButton,
  Input,
  Num,
  NumericInput,
  Radio,
  SearchInput,
  SegmentedControl,
  Select,
  Seam,
  SeamRule,
  Side,
  StatusDot,
  Tag,
  Textarea,
  TextLink,
  Toggle,
  Tooltip,
  CloseIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/ui";
import { Note, Panel, Section, SubHead } from "../_components/ui";

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

  const notional = (Number(price) || 0) * (Number(qty) || 0);

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 lg:px-8">
      {/* ------------------------------------------------------- masthead -- */}
      <header className="mb-10 border-b border-border-subtle pt-14 pb-10">
        <div className="mb-4 flex flex-wrap items-center gap-2.5 font-mono text-micro uppercase text-text-tertiary">
          <StatusDot intent="online" label="Phase 2 in progress" />
          Perp v2 · Phase 2 · Base components
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
            <IconButton label="Close" intent="danger"><CloseIcon /></IconButton>
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
        </Panel>
      </Section>

      {/* ----------------------------------------------------- indicators -- */}
      <Section id="indicators" num="04" title="Indicators" note="badges · dots · avatars">
        <Panel>
          <Row label="Badge">
            <Badge>Neutral</Badge>
            <Badge intent="buy">Filled</Badge>
            <Badge intent="sell">Cancelled</Badge>
            <Badge intent="info">Open</Badge>
            <Badge intent="warning">Partial</Badge>
            <Badge intent="danger">Liquidated</Badge>
            <Badge intent="outline">10x</Badge>
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
        </Panel>
      </Section>

      {/* ---------------------------------------------------- directional -- */}
      <Section
        id="directional"
        num="05"
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
        num="06"
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
        num="07"
        title="Composed"
        note="atoms under load"
      >
        <Note>
          A real order ticket assembled only from the atoms above — no bespoke
          styles. This is the check that the primitives actually hold together
          before Phase 3 starts building organisms on them.
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
  );
}

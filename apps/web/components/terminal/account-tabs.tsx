"use client";

import { useEffect, useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";
import { formatNumber, formatTime, formatUsd, truncateId } from "@/lib/format";
import type { Market } from "@/lib/markets";
import {
  Badge,
  Button,
  Delta,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  LayersIcon,
  ListIcon,
  Num,
  ScrollArea,
  Side,
  SkeletonRegion,
  SkeletonTable,
  WalletIcon,
} from "@/components/ui";
import { DepositButton } from "./deposit-dialog";
import { useAccount } from "@/lib/account";

/**
 * The bottom panel: positions, open orders, fills, balances, order history.
 *
 * Radix Tabs rather than hand-rolled buttons — it supplies roving tabindex,
 * arrow-key navigation and the aria-controls/aria-labelledby pairing between
 * each tab and its panel.
 *
 * Rows below are placeholder shapes matching the drizzle schema (orders.status
 * enum, fills maker/taker) so the table layouts are real ahead of the API
 * client landing.
 */

/**
 * Placeholder rows, generated rather than hand-written so the tables can be
 * judged at realistic length. Deterministic (seeded LCG, fixed epoch) so every
 * render and every reload produces identical data — random mock rows make it
 * impossible to tell a layout regression from noise.
 *
 * Shapes match the drizzle schema. Swap these for the API client; nothing in
 * the table markup below should need to change.
 */
const EPOCH = Date.UTC(2026, 7, 19, 12, 0, 0);

function makeRng(seed: number) {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  // Discard the first few draws. An LCG seeded with a small integer produces a
  // first output in a narrow band, so with one generator per row every row got
  // a near-identical opening value — which is why the entry price landed on the
  // same side of the mark every time and all six positions shared a sign.
  for (let i = 0; i < 8; i++) next();
  return next;
}

/** `maxSize` is per instrument — 14 BTC and 14 SOL are wildly different trades. */
const INSTRUMENTS = [
  { market: "SOL-USD", px: 77.5, dp: 2, sp: 2, maxSize: 40 },
  { market: "BTC-USD", px: 68450, dp: 1, sp: 4, maxSize: 0.35 },
  { market: "ETH-USD", px: 1896, dp: 2, sp: 3, maxSize: 4 },
];

const POSITIONS = Array.from({ length: 6 }, (_, i) => {
  const r = makeRng(i + 11);
  const inst = INSTRUMENTS[i % INSTRUMENTS.length]!;
  // Side alternates rather than following the same RNG stream as `entry`.
  // Drawing both from consecutive values happened to correlate them and made
  // every one of the six positions a winner, so the losing/red path in the PnL
  // column was never rendered.
  const long = i % 2 === 0;
  const dir = long ? 1 : -1;
  const entry = inst.px * (1 + (r() - 0.5) * 0.06);
  const size = r() * inst.maxSize + inst.maxSize * 0.05;
  const leverage = [2, 3, 5, 10][i % 4]!;

  // Derived, not invented: PnL follows from size and the entry/mark spread, and
  // margin follows from notional and leverage. An earlier version generated
  // these independently and produced a 13 BTC position on $924 margin at +774%.
  const pnl = (inst.px - entry) * size * dir;
  const margin = (entry * size) / leverage;

  return {
    id: `p${i}`,
    market: inst.market,
    side: (long ? "LONG" : "SHORT") as "LONG" | "SHORT",
    size: size.toFixed(inst.sp),
    entry: entry.toFixed(inst.dp),
    mark: inst.px.toFixed(inst.dp),
    pnl: Number(pnl.toFixed(2)),
    roe: Number(((pnl / margin) * 100).toFixed(2)),
    margin: Number(margin.toFixed(2)),
    leverage,
    // Liquidation sits roughly one margin-width against the position.
    liq: (entry * (1 - dir / leverage)).toFixed(inst.dp),
  };
});

const ORDER_STATUSES = ["open", "partially_filled"] as const;

const OPEN_ORDERS = Array.from({ length: 14 }, (_, i) => {
  const r = makeRng(i + 101);
  const inst = INSTRUMENTS[i % INSTRUMENTS.length]!;
  const qty = r() * inst.maxSize + inst.maxSize * 0.05;
  const status = ORDER_STATUSES[i % 2]!;
  return {
    id: `a1b2c3d4-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
    market: inst.market,
    side: (r() > 0.5 ? "LONG" : "SHORT") as "LONG" | "SHORT",
    type: r() > 0.75 ? "market" : "limit",
    price: (inst.px * (1 + (r() - 0.5) * 0.04)).toFixed(inst.dp),
    qty: qty.toFixed(inst.sp),
    filled: (status === "partially_filled" ? qty * r() : 0).toFixed(inst.sp),
    status,
    ts: EPOCH - i * 137_000,
  };
});

const FILLS = Array.from({ length: 30 }, (_, i) => {
  const r = makeRng(i + 211);
  const inst = INSTRUMENTS[i % INSTRUMENTS.length]!;
  const qty = r() * inst.maxSize * 0.6 + inst.maxSize * 0.02;
  const px = inst.px * (1 + (r() - 0.5) * 0.03);
  return {
    id: `f${i}`,
    market: inst.market,
    side: (r() > 0.5 ? "LONG" : "SHORT") as "LONG" | "SHORT",
    price: px.toFixed(inst.dp),
    qty: qty.toFixed(inst.sp),
    fee: (px * qty * 0.0004).toFixed(2),
    role: r() > 0.55 ? "maker" : "taker",
    ts: EPOCH - i * 61_000,
  };
});

const HISTORY_STATUSES = ["filled", "cancelled"] as const;

const ORDER_HISTORY = Array.from({ length: 24 }, (_, i) => {
  const r = makeRng(i + 307);
  const inst = INSTRUMENTS[i % INSTRUMENTS.length]!;
  const qty = r() * inst.maxSize * 0.8 + inst.maxSize * 0.03;
  const status = HISTORY_STATUSES[i % 3 === 0 ? 1 : 0]!;
  return {
    id: `b7c8d9e0-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
    market: inst.market,
    side: (r() > 0.5 ? "LONG" : "SHORT") as "LONG" | "SHORT",
    type: r() > 0.7 ? "market" : "limit",
    price: (inst.px * (1 + (r() - 0.5) * 0.05)).toFixed(inst.dp),
    qty: qty.toFixed(inst.sp),
    filled: (status === "filled" ? qty : qty * 0.3).toFixed(inst.sp),
    status,
    ts: EPOCH - i * 940_000,
  };
});

/**
 * Collateral is a SINGLE balance, not a portfolio of assets.
 *
 * This tab used to list USD, USDC, SOL, BTC, ETH, JUP and PYTH. The engine's
 * `TCollateral` is one `{ available, locked }` pair in an unnamed unit (G14),
 * so six of those seven rows had no backing data and never would without a
 * multi-collateral engine. One row, three real numbers.
 */

/**
 * Order status → badge intent.
 *
 * NON-DIRECTIONAL INTENTS ONLY. `buy` and `sell` are reserved for market
 * direction, and the Side column sits three cells from Status — a green FILLED
 * badge landing beside a green LONG badge is exactly the ambiguity the
 * green-means-long rule exists to prevent. `filled` was green here and this is
 * the fix.
 *
 * filled and cancelled are both terminal and both quiet; `outline` vs `neutral`
 * separates them without either shouting.
 */
const STATUS_INTENT = {
  pending: "neutral",
  open: "info",
  partially_filled: "warning",
  filled: "outline",
  cancelled: "neutral",
} as const;

function Table({
  head,
  children,
}: {
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={cn(
                  "border-b border-border-subtle px-3 py-2 text-micro font-medium uppercase whitespace-nowrap text-text-tertiary",
                  i === 0 ? "text-left" : "text-right",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  first,
  className,
}: {
  children: React.ReactNode;
  first?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-border-subtle px-3 py-2 text-num-md tnum whitespace-nowrap",
        first ? "text-left" : "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * First-load gate for the account tables.
 *
 * TODO(api): replace with the real request state once the API client lands —
 * this exists so the skeleton path is on screen every load rather than being
 * code that only runs in a story. The rows themselves are still the seeded
 * generators above.
 *
 * It starts `true` on the server and on the first client render, so the two
 * trees match and there is no hydration mismatch.
 */
function useFirstLoad(ms = 700) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setLoading(false), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
  return loading;
}

/**
 * One tab body, with the three states every table here has to handle.
 *
 * Centralised rather than repeated five times because the ordering matters and
 * is easy to get subtly wrong: loading must be checked BEFORE empty, or an
 * account with no positions flashes "No open positions" on every page load
 * before its data arrives — telling the user something false about their money.
 */
function TabPanel({
  value,
  loading,
  head,
  isEmpty,
  empty,
  children,
}: {
  value: string;
  loading: boolean;
  head: string[];
  isEmpty: boolean;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <TabsPrimitive.Content value={value}>
      {loading ? (
        <SkeletonRegion label={`Loading ${value}`}>
          {/* Same wrapper and same min-width as the real Table, so the columns
              resolve identically and nothing shifts when the rows arrive. */}
          <div className="scrollbar-thin overflow-x-auto">
            <SkeletonTable
              columns={head.filter(Boolean)}
              rows={5}
              className="min-w-[640px]"
            />
          </div>
        </SkeletonRegion>
      ) : isEmpty ? (
        empty
      ) : (
        <Table head={head}>{children}</Table>
      )}
    </TabsPrimitive.Content>
  );
}

/**
 * Close is the one row action that confirms. It submits a market order at
 * whatever the book offers, crystallising an unrealised PnL into a real one —
 * there is no undo, and the number the user sees is not the number they get.
 */
function ClosePositionButton({
  position,
}: {
  position: (typeof POSITIONS)[number];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button intent="danger-ghost" size="sm" onClick={() => setOpen(true)}>
        Close
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Close {position.market} position?</DialogTitle>
          <DialogDescription>
            This submits a market order for the full size. The fill price
            depends on the book and will not exactly match the mark shown here.
          </DialogDescription>

          <dl className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-inset p-3 text-body-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Position</dt>
              <dd className="flex items-center gap-2">
                <Side side={position.side} size="sm" />
                <span className="text-num-md tnum text-text-primary">
                  {position.size}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Mark</dt>
              <dd className="text-num-md tnum text-text-primary">
                {position.mark}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Unrealised PnL</dt>
              <dd>
                <Delta value={position.pnl} unit="USD" size="sm" />
              </dd>
            </div>
          </dl>

          {/* `*:flex-1` splits the row evenly. `fullWidth` (w-full) cannot be
              used here: two w-full items in a flex row each claim 100% of the
              container, so together they overflowed past the dialog edge. */}
          <div className="flex gap-2 *:flex-1">
            <DialogClose asChild>
              <Button intent="neutral">Keep position</Button>
            </DialogClose>
            {/* Solid danger here — the action is committed at this point. */}
            <Button intent="danger" onClick={() => setOpen(false)}>
              Close position
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const TABS = [
  { value: "positions", label: "Positions", count: POSITIONS.length },
  { value: "orders", label: "Open orders", count: OPEN_ORDERS.length },
  { value: "fills", label: "Fill history", count: null },
  { value: "balances", label: "Balances", count: null },
  { value: "history", label: "Order history", count: null },
];

export function AccountTabs({
  market,
  className,
}: {
  market: Market;
  className?: string;
}) {
  const account = useAccount();
  const loading = useFirstLoad();

  return (
    <TabsPrimitive.Root
      defaultValue="positions"
      className={cn("flex min-h-0 flex-col", className)}
    >
      <TabsPrimitive.List className="scrollbar-thin flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle px-2">
        {TABS.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              "flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-body-sm whitespace-nowrap",
              "text-text-tertiary transition-colors duration-fast",
              "hover:text-text-secondary",
              "focus-visible:outline-none focus-visible:shadow-focus",
              "data-[state=active]:border-b-interactive data-[state=active]:text-text-primary",
            )}
          >
            {t.label}
            {t.count ? (
              <Badge intent="neutral" size="sm">
                {t.count}
              </Badge>
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>

      <ScrollArea className="min-h-0 flex-1">
        <TabPanel
          value="positions"
          loading={loading}
          head={[
            "Market",
            "Size",
            "Entry",
            "Mark",
            "Liq. price",
            "Margin",
            "PnL",
            "",
          ]}
          isEmpty={POSITIONS.length === 0}
          empty={
            <EmptyState
              icon={LayersIcon}
              title="No open positions"
              description="A position opens here as soon as one of your orders fills."
            />
          }
        >
          {POSITIONS.map((p) => (
            <tr key={p.id} className="hover:bg-surface-hover">
              <Td first>
                <span className="flex items-center gap-2">
                  <Side side={p.side} size="sm" />
                  <span className="text-text-primary">{p.market}</span>
                </span>
              </Td>
              <Td>{p.size}</Td>
              <Td>{p.entry}</Td>
              <Td>{p.mark}</Td>
              <Td className="text-warning">{p.liq}</Td>
              <Td>
                <span className="flex items-center justify-end gap-1.5">
                  {formatUsd(p.margin)}
                  <Badge intent="outline" size="sm">
                    {p.leverage}x
                  </Badge>
                </span>
              </Td>
              <Td>
                <span className="flex flex-col items-end">
                  <Delta value={p.pnl} unit="USD" size="sm" />
                  <Delta value={p.roe} percent size="sm" />
                </span>
              </Td>
              <Td>
                {/* Closing fires a market order and realises PnL — it is not
                      reversible, so it confirms. Cancel below does not. */}
                <ClosePositionButton position={p} />
              </Td>
            </tr>
          ))}
        </TabPanel>

        <TabPanel
          value="orders"
          loading={loading}
          head={[
            "Order",
            "Market",
            "Side",
            "Type",
            "Price",
            "Qty",
            "Filled",
            "Status",
            "",
          ]}
          isEmpty={OPEN_ORDERS.length === 0}
          empty={
            <EmptyState
              icon={ListIcon}
              title="No open orders"
              description="Resting limit orders stay here until they fill or you cancel them."
            />
          }
        >
          {OPEN_ORDERS.map((o) => (
            <tr key={o.id} className="hover:bg-surface-hover">
              <Td first>
                <span className="font-mono text-text-tertiary">
                  {truncateId(o.id)}
                </span>
              </Td>
              <Td className="text-text-primary">{o.market}</Td>
              <Td>
                <Side side={o.side} size="sm" />
              </Td>
              <Td className="text-text-secondary">{o.type}</Td>
              <Td>{o.price}</Td>
              <Td>{o.qty}</Td>
              <Td className="text-text-secondary">{o.filled}</Td>
              <Td>
                <Badge intent={STATUS_INTENT[o.status]} size="sm">
                  {o.status.replace("_", " ")}
                </Badge>
              </Td>
              <Td>
                <Button intent="danger-ghost" size="sm">
                  Cancel
                </Button>
              </Td>
            </tr>
          ))}
        </TabPanel>

        <TabPanel
          value="fills"
          loading={loading}
          head={["Time", "Market", "Side", "Price", "Qty", "Role", "Fee"]}
          isEmpty={FILLS.length === 0}
          empty={
            <EmptyState
              icon={ListIcon}
              title="No fills yet"
              description="Every execution is recorded here, with its maker or taker fee."
            />
          }
        >
          {FILLS.map((f) => (
            <tr key={f.id} className="hover:bg-surface-hover">
              <Td first className="text-text-tertiary">
                {formatTime(f.ts)}
              </Td>
              <Td className="text-text-primary">{f.market}</Td>
              <Td>
                <Side side={f.side} size="sm" />
              </Td>
              <Td>{f.price}</Td>
              <Td>{f.qty}</Td>
              <Td className="text-text-secondary">{f.role}</Td>
              <Td className="text-text-tertiary">{f.fee}</Td>
            </tr>
          ))}
        </TabPanel>

        <TabPanel
          value="balances"
          head={["Asset", "Total", "Available", "In orders"]}
          loading={account.status === "loading"}
          isEmpty={account.status === "ready" && account.data.equity === "0"}
          empty={
            <EmptyState
              icon={WalletIcon}
              title="No collateral deposited"
              description="Deposit to fund your cross-margin account and start trading."
              // The one empty state in the app with an obvious next action, so
              // it is the one that gets a button.
              action={<DepositButton size="md" />}
            />
          }
        >
          {account.status === "ready" && (
            <tr className="hover:bg-surface-hover">
              <Td first className="text-text-primary">
                USD
              </Td>
              <Td>
                <Num value={account.data.equity} />
              </Td>
              <Td>{account.data.available}</Td>
              <Td className="text-text-tertiary">{account.data.marginUsed}</Td>
            </tr>
          )}
        </TabPanel>

        <TabPanel
          value="history"
          loading={loading}
          head={[
            "Time",
            "Order",
            "Market",
            "Side",
            "Type",
            "Price",
            "Qty",
            "Filled",
            "Status",
          ]}
          isEmpty={ORDER_HISTORY.length === 0}
          empty={
            <EmptyState
              icon={ListIcon}
              title="No order history"
              description="Filled and cancelled orders are archived here."
            />
          }
        >
          {ORDER_HISTORY.map((o) => (
            <tr key={o.id} className="hover:bg-surface-hover">
              <Td first className="text-text-tertiary">
                {formatTime(o.ts)}
              </Td>
              <Td>
                <span className="font-mono text-text-tertiary">
                  {truncateId(o.id)}
                </span>
              </Td>
              <Td className="text-text-primary">{o.market}</Td>
              <Td>
                <Side side={o.side} size="sm" />
              </Td>
              <Td className="text-text-secondary">{o.type}</Td>
              <Td>{o.price}</Td>
              <Td>{o.qty}</Td>
              <Td className="text-text-secondary">{o.filled}</Td>
              <Td>
                <Badge intent={STATUS_INTENT[o.status]} size="sm">
                  {o.status}
                </Badge>
              </Td>
            </tr>
          ))}
        </TabPanel>
      </ScrollArea>
    </TabsPrimitive.Root>
  );
}

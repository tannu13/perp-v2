"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";
import { formatNumber, formatTime, formatUsd, truncateId } from "@/lib/format";
import type { Market } from "@/lib/markets";
import { Badge, Button, Delta, Num, Side } from "@/components/ui";

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

const POSITIONS = [
  { id: "1", market: "SOL-USD", side: "LONG" as const, size: "12.40", entry: "203.88", mark: "205.09", pnl: 15.0, roe: 3.68, margin: 252.8, liq: "182.44" },
  { id: "2", market: "BTC-USD", side: "SHORT" as const, size: "0.0450", entry: "68910.0", mark: "68450.5", pnl: 20.68, roe: 6.67, margin: 310.1, liq: "72104.0" },
];

const OPEN_ORDERS = [
  { id: "a1b2c3d4-0000-0000-0000-000000000001", side: "LONG" as const, type: "limit", price: "204.96", qty: "4.74", filled: "0.00", status: "open" as const, ts: Date.now() - 420000 },
  { id: "a1b2c3d4-0000-0000-0000-000000000002", side: "SHORT" as const, type: "limit", price: "206.50", qty: "2.00", filled: "0.85", status: "partially_filled" as const, ts: Date.now() - 90000 },
];

const FILLS = [
  { id: "f1", side: "LONG" as const, price: "204.11", qty: "3.20", fee: "0.33", role: "taker", ts: Date.now() - 60000 },
  { id: "f2", side: "LONG" as const, price: "203.88", qty: "9.20", fee: "0.94", role: "maker", ts: Date.now() - 180000 },
  { id: "f3", side: "SHORT" as const, price: "68910.00", qty: "0.0450", fee: "1.24", role: "taker", ts: Date.now() - 900000 },
];

const BALANCES = [
  { asset: "USD", total: "2521.00", available: "1958.10", inOrders: "562.90" },
];

const STATUS_INTENT = {
  open: "info",
  partially_filled: "warning",
  filled: "buy",
  cancelled: "neutral",
  pending: "neutral",
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-10 text-center text-body-sm text-text-tertiary">
      {children}
    </p>
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

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <TabsPrimitive.Content value="positions">
          <Table head={["Market", "Size", "Entry", "Mark", "Liq. price", "Margin", "PnL", ""]}>
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
                <Td>{formatUsd(p.margin)}</Td>
                <Td>
                  <span className="flex flex-col items-end">
                    <Delta value={p.pnl} unit="USD" size="sm" />
                    <Delta value={p.roe} percent size="sm" />
                  </span>
                </Td>
                <Td>
                  <Button intent="ghost" size="sm">
                    Close
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="orders">
          <Table head={["Order", "Side", "Type", "Price", "Qty", "Filled", "Status", ""]}>
            {OPEN_ORDERS.map((o) => (
              <tr key={o.id} className="hover:bg-surface-hover">
                <Td first>
                  <span className="font-mono text-text-tertiary">
                    {truncateId(o.id)}
                  </span>
                </Td>
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
                  <Button intent="ghost" size="sm">
                    Cancel
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="fills">
          <Table head={["Time", "Side", "Price", "Qty", "Role", "Fee"]}>
            {FILLS.map((f) => (
              <tr key={f.id} className="hover:bg-surface-hover">
                <Td first className="text-text-tertiary">
                  {formatTime(f.ts)}
                </Td>
                <Td>
                  <Side side={f.side} size="sm" />
                </Td>
                <Td>{f.price}</Td>
                <Td>{f.qty}</Td>
                <Td className="text-text-secondary">{f.role}</Td>
                <Td className="text-text-tertiary">{f.fee}</Td>
              </tr>
            ))}
          </Table>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="balances">
          <Table head={["Asset", "Total", "Available", "In orders"]}>
            {BALANCES.map((b) => (
              <tr key={b.asset} className="hover:bg-surface-hover">
                <Td first className="text-text-primary">
                  {b.asset}
                </Td>
                <Td>
                  <Num value={b.total} />
                </Td>
                <Td>{b.available}</Td>
                <Td className="text-text-tertiary">{b.inOrders}</Td>
              </tr>
            ))}
          </Table>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="history">
          <Empty>
            No completed orders yet. Filled and cancelled orders appear here.
          </Empty>
        </TabsPrimitive.Content>
      </div>
    </TabsPrimitive.Root>
  );
}

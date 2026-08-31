"use client";

import { useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";
import {
  formatDateTime,
  formatNumber,
  formatUsd,
  truncateId,
} from "@/lib/format";
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
  ErrorState,
  LayersIcon,
  ListIcon,
  Num,
  ScrollArea,
  Side,
  SkeletonRegion,
  SkeletonTable,
  WalletIcon,
  useToast,
} from "@/components/ui";
import { DepositButton } from "./deposit-dialog";
import { useAccount } from "@/lib/account";
import { useHistory, type FillRow, type HistoryOrder } from "@/lib/history";
import { useOrders, type OpenOrder } from "@/lib/orders";
import { usePositions, type OpenPosition } from "@/lib/positions";
import {
  CLOSE_SLIPPAGE_PERCENT,
  followedBy,
  rejectionMessage,
} from "./order-payload";
import { ApiError } from "@/lib/api/errors";

/**
 * The bottom panel: positions, open orders, fills, balances, order history.
 *
 * Radix Tabs rather than hand-rolled buttons — it supplies roving tabindex,
 * arrow-key navigation and the aria-controls/aria-labelledby pairing between
 * each tab and its panel.
 *
 * As of Phase 10 every one of the five reads a real request. Not a generated
 * row is left in this file: the seeded RNG, the fixed epoch and the instrument
 * table that backed fills and order history went out with them.
 */

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

/*
 * `useFirstLoad(700)` used to sit here — a fake 700ms latency gate so the
 * skeleton path was on screen every load. It is deleted, and as of Phase 10
 * every panel below passes its own request state: there is no table left whose
 * rows are already in the bundle, so there is nothing left to pretend about.
 */

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
  error,
  head,
  isEmpty,
  empty,
  footer,
  children,
}: {
  value: string;
  loading: boolean;
  /** Rendered instead of the table. Checked after loading, before empty. */
  error?: React.ReactNode;
  head: string[];
  isEmpty: boolean;
  empty: React.ReactNode;
  /**
   * Rendered under the table, and only when there IS a table. It exists for
   * the fills "Load more" — a button inside `tbody` is not valid markup, and a
   * pager under an empty state or a skeleton is offering more of nothing.
   */
  footer?: React.ReactNode;
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
      ) : error ? (
        /* Before empty as well as after loading: "No open orders" is a claim
           about the account, and a failed request is not evidence for it. */
        error
      ) : isEmpty ? (
        empty
      ) : (
        <>
          <Table head={head}>{children}</Table>
          {footer}
        </>
      )}
    </TabsPrimitive.Content>
  );
}

/**
 * Close is the one row action that confirms.
 *
 * Per CLAUDE.md: actions that realise money confirm. This submits a market
 * order for the full size, crystallising an unrealised PnL into a real one —
 * there is no undo, and the number on screen is a mark, not the price the book
 * will give.
 *
 * It is therefore NOT optimistic, unlike Cancel. The row stays exactly where it
 * is until the refetch says the position is gone: a market close can be refused
 * outright ("There are no matches available") or fill only part of the size,
 * and a row that vanished on submit would claim a flat book position the user
 * does not have.
 */
function ClosePositionButton({ position }: { position: OpenPosition }) {
  const [open, setOpen] = useState(false);
  const positions = usePositions();

  /**
   * The refusal, rendered INSIDE the dialog. This is D11.
   *
   * It used to be a toast, and the toast was invisible to the people most
   * likely to need it: the dialog stays open on a failure — deliberately, so
   * the obvious next action is the button already under the cursor — and Radix
   * marks everything outside an open dialog `aria-hidden`. The toast viewport
   * lives at the app root, so the engine's own words were painted, readable,
   * and out of the accessibility tree, on the one action in this app that
   * realises money. The Phase 9 spec that could not see it either is what
   * found it.
   *
   * Inside the dialog it is in the tree, it is where the eye already is, and
   * `role="alert"` on `ErrorState` announces it without moving focus off the
   * retry.
   */
  const [failure, setFailure] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const inFlight = positions.closing.includes(position.marketId);

  const onClose = async () => {
    setFailure(null);
    try {
      await positions.close(position);
      /**
       * Nothing is refreshed. A close moves the position, the collateral and —
       * because it crosses the book — somebody's resting orders, possibly this
       * account's own; the engine publishes all three as absolute events on
       * the private channel and each provider applies its own.
       *
       * The dialog still closes only on success, and only after the request
       * resolves. That is unchanged and is not about staleness: a close can be
       * refused outright, and the user needs to be looking at the dialog when
       * it is.
       */
      setOpen(false);
      setFailure(null);
    } catch (err) {
      // Already becoming a sign-out and a redirect; reporting it here as well
      // is noise. Same rule the ticket and Cancel both follow.
      if (err instanceof ApiError && err.isSilent) return;

      /**
       * Three failures, and only one of them means the position is untouched.
       *
       * A rejection is the engine having decided ("There are no matches
       * available"): nothing happened, and trying again is reasonable. An
       * engine timeout or a dead network is the opposite — the request left
       * and no answer came back, so the close may be executing right now, and
       * "try again" could flatten the position twice. Saying "Could not close"
       * for that case would be a claim the client cannot make.
       */
      setFailure(
        err instanceof ApiError && err.isOutcomeUnknown
          ? {
              title: "Close not confirmed",
              description: followedBy(
                err.message,
                "This close may still have gone through — check your positions before trying again.",
              ),
            }
          : {
              title: "Could not close position",
              // The engine's own words. "There are no matches available" tells
              // the user something true and actionable; a generic line does not.
              description: rejectionMessage(err),
            },
      );
    }
  };

  return (
    <>
      <Button intent="danger-ghost" size="sm" onClick={() => setOpen(true)}>
        Close
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // A dismissed dialog must not reopen still holding the last attempt's
          // refusal — the book has moved on and so has the reason.
          if (!next) setFailure(null);
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogTitle>Close {position.market.slug} position?</DialogTitle>
          <DialogDescription>
            This submits a market order for the full size, with a{" "}
            {CLOSE_SLIPPAGE_PERCENT}% slippage band. The fill price depends on
            the book and will not exactly match the mark shown here.
          </DialogDescription>

          <dl className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-inset p-3 text-body-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Position</dt>
              <dd className="flex items-center gap-2">
                <Side side={position.type} size="sm" />
                <span className="text-num-md tnum text-text-primary">
                  {formatNumber(position.qty, position.market.sizeDecimals)}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Mark</dt>
              <dd className="text-num-md tnum text-text-primary">
                {/* Em dash, not a stale price: a one-sided book has no mid, and
                    the close is still allowed — the engine decides the fill. */}
                {position.mark === null
                  ? "—"
                  : formatNumber(position.mark, position.market.priceDecimals)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Unrealised PnL</dt>
              <dd>
                {position.unrealisedPnl === null ? (
                  <span className="text-num-md text-text-tertiary">—</span>
                ) : (
                  <Delta value={position.unrealisedPnl} unit="USD" size="sm" />
                )}
              </dd>
            </div>
          </dl>

          {failure && (
            /* `size="sm"` keeps the dialog from growing past the viewport on a
               phone; the message is one line and the retry is the button
               below, so this one carries no `onRetry` of its own. */
            <ErrorState
              size="sm"
              title={failure.title}
              description={failure.description}
            />
          )}

          {/* `*:flex-1` splits the row evenly. `fullWidth` (w-full) cannot be
              used here: two w-full items in a flex row each claim 100% of the
              container, so together they overflowed past the dialog edge. */}
          <div className="flex gap-2 *:flex-1">
            <DialogClose asChild>
              <Button intent="neutral" disabled={inFlight}>
                Keep position
              </Button>
            </DialogClose>
            {/* Solid danger here — the action is committed at this point. */}
            <Button
              intent="danger"
              loading={inFlight}
              disabled={inFlight}
              onClick={() => void onClose()}
            >
              Close position
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Cancel, the one destructive row action that does NOT confirm.
 *
 * Per CLAUDE.md: actions that realise money confirm, cancelling a resting order
 * does not. Nothing is crystallised — the margin comes back and the order was
 * never a position — so a dialog here would be ceremony in front of a
 * reversible act (place it again).
 *
 * It is optimistic instead, which is why the failure path matters: the row
 * disappears immediately and `useOrders().cancel` puts it back if the request
 * fails. The toast is the only way the user learns that happened, because the
 * restored row looks exactly like the one that was already there.
 */
function CancelOrderButton({ order }: { order: OpenOrder }) {
  const orders = useOrders();
  const { toast } = useToast();
  const inFlight = orders.cancelling.includes(order.id);

  const onCancel = async () => {
    try {
      await orders.cancel(order.id);
    } catch (err) {
      // A 401 is already becoming a sign-out and a redirect; a toast on the way
      // out is noise. Same rule the order ticket follows.
      if (err instanceof ApiError && err.isSilent) return;
      /**
       * Same three-way split as the close, and the same reason.
       *
       * The row has already been put back by `useOrders().cancel` — that is
       * what makes the optimism safe — but "the order is still resting" is a
       * statement about the book, and after an engine timeout the client does
       * not know whether the cancel landed. The restored row is the honest
       * default; the words have to admit it might be wrong.
       */
      const unknown = err instanceof ApiError && err.isOutcomeUnknown;
      toast({
        intent: "danger",
        title: unknown ? "Cancel not confirmed" : "Could not cancel order",
        description:
          err instanceof ApiError && err.isOutcomeUnknown
            ? followedBy(
                err.message,
                "The order is shown as it was — it may still have been cancelled.",
              )
            : err instanceof ApiError
              ? err.message
              : "The order is still resting on the book.",
      });
    }
  };

  return (
    <Button
      intent="danger-ghost"
      size="sm"
      loading={inFlight}
      disabled={inFlight}
      onClick={() => void onCancel()}
    >
      Cancel
    </Button>
  );
}

const TABS = [
  { value: "positions", label: "Positions" },
  { value: "orders", label: "Open orders" },
  { value: "fills", label: "Fill history" },
  { value: "balances", label: "Balances" },
  { value: "history", label: "Order history" },
] as const;

export function AccountTabs({
  market,
  className,
}: {
  market: Market;
  className?: string;
}) {
  const account = useAccount();
  const orders = useOrders();
  const positions = usePositions();
  const history = useHistory();
  const openOrders = orders.status === "ready" ? orders.orders : [];
  const openPositions = positions.status === "ready" ? positions.positions : [];
  const fills: FillRow[] = history.status === "ready" ? history.fills : [];
  const historyOrders: HistoryOrder[] =
    history.status === "ready" ? history.orders : [];

  /**
   * `idle` shows the skeleton too. It is the state before the tab has been
   * opened for the first time, and `activate` fires in the same interaction
   * that reveals the panel — so the alternative to a skeleton here is one frame
   * of "No fills yet", which is a claim about the account.
   */
  const historyLoading =
    history.status === "loading" || history.status === "idle";

  /**
   * Only the two live tabs are counted.
   *
   * Positions and Open orders are bounded lists of things happening now, and
   * the number is the point. Fills and order history are unbounded and lazy:
   * before the tab is opened there is no number, and after it there is a page
   * size rather than a total — a badge reading "100" next to Fill history would
   * be a statement about the request, not about the account.
   */
  const counts: Partial<Record<(typeof TABS)[number]["value"], number>> = {
    positions: openPositions.length,
    orders: openOrders.length,
  };

  return (
    <TabsPrimitive.Root
      defaultValue="positions"
      /**
       * The lazy load's trigger. Uncontrolled Radix still reports every change,
       * so this stays a one-line hook rather than lifting the active tab into
       * React state. `activate` is idempotent — first call loads, later ones
       * refresh in the background — so re-opening the tab after placing an
       * order is what fetches the fill it just made.
       */
      onValueChange={(value) => {
        if (value === "fills" || value === "history") history.activate();
      }}
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
            {counts[t.value] ? (
              <Badge intent="neutral" size="sm">
                {counts[t.value]}
              </Badge>
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>

      <ScrollArea className="min-h-0 flex-1">
        <TabPanel
          value="positions"
          loading={positions.status === "loading"}
          error={
            positions.status === "error" ? (
              <ErrorState
                title="Couldn't load positions"
                description="Your positions are unchanged — this is only the view."
                detail={positions.error}
                onRetry={() => void positions.refresh()}
              />
            ) : null
          }
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
          isEmpty={openPositions.length === 0}
          empty={
            <EmptyState
              icon={LayersIcon}
              title="No open positions"
              description="A position opens here as soon as one of your orders fills."
            />
          }
        >
          {openPositions.map((p) => (
            /* `marketId` as the key, not an id: the engine has no position id,
               and one-way netting guarantees at most one position per market. */
            <tr key={p.marketId} className="hover:bg-surface-hover">
              <Td first>
                <span className="flex items-center gap-2">
                  <Side side={p.type} size="sm" />
                  <span className="text-text-primary">{p.market.slug}</span>
                </span>
              </Td>
              <Td>{formatNumber(p.qty, p.market.sizeDecimals)}</Td>
              <Td>{formatNumber(p.averagePrice, p.market.priceDecimals)}</Td>
              <Td>
                {/* Every derived column below is an em dash when its input is
                    unknown, never a zero. See `position-math.ts`. */}
                {p.mark === null
                  ? "—"
                  : formatNumber(p.mark, p.market.priceDecimals)}
              </Td>
              <Td className="text-warning">
                {formatNumber(p.liquidationPrice, p.market.priceDecimals)}
              </Td>
              <Td>
                <span className="flex items-center justify-end gap-1.5">
                  {formatUsd(p.margin)}
                  {p.leverage === null ? null : (
                    <Badge intent="outline" size="sm">
                      {Math.round(p.leverage)}x
                    </Badge>
                  )}
                </span>
              </Td>
              <Td>
                {p.unrealisedPnl === null ? (
                  <span className="text-text-tertiary">—</span>
                ) : (
                  <span className="flex flex-col items-end">
                    <Delta value={p.unrealisedPnl} unit="USD" size="sm" />
                    {p.roe === null ? null : (
                      <Delta value={p.roe} percent size="sm" />
                    )}
                  </span>
                )}
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
          loading={orders.status === "loading"}
          error={
            orders.status === "error" ? (
              <ErrorState
                title="Couldn't load open orders"
                description="Your resting orders are still on the book — this is only the view."
                detail={orders.error}
                onRetry={() => void orders.refresh()}
              />
            ) : null
          }
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
          isEmpty={openOrders.length === 0}
          empty={
            <EmptyState
              icon={ListIcon}
              title="No open orders"
              description="Resting limit orders stay here until they fill or you cancel them."
            />
          }
        >
          {openOrders.map((o) => (
            <tr key={o.id} className="hover:bg-surface-hover">
              <Td first>
                <span className="font-mono text-text-tertiary">
                  {truncateId(o.id)}
                </span>
              </Td>
              <Td className="text-text-primary">{o.market.slug}</Td>
              <Td>
                <Side side={o.positionType} size="sm" />
              </Td>
              <Td className="text-text-secondary">{o.orderType}</Td>
              <Td>
                {/*
                  A market order's `price` column holds 0: the backend inserts
                  the row from the client payload, and nothing writes the
                  executed price back (order_updates carries only status and
                  filledQty). A market order cannot rest, so this branch should
                  be unreachable — printing an em dash rather than "0.00" is what
                  keeps it honest if it ever is reached.
                */}
                {o.orderType === "market"
                  ? "—"
                  : formatNumber(o.price, o.market.priceDecimals)}
              </Td>
              <Td>{formatNumber(o.qty, o.market.sizeDecimals)}</Td>
              <Td className="text-text-secondary">
                {formatNumber(o.filledQty, o.market.sizeDecimals)}
              </Td>
              <Td>
                <Badge intent={STATUS_INTENT[o.status]} size="sm">
                  {o.status.replace("_", " ")}
                </Badge>
              </Td>
              <Td>
                <CancelOrderButton order={o} />
              </Td>
            </tr>
          ))}
        </TabPanel>

        <TabPanel
          value="fills"
          loading={historyLoading}
          error={
            history.status === "error" ? (
              <ErrorState
                title="Couldn't load your fills"
                description="Nothing about your trades has changed — this is only the view."
                detail={history.error}
                onRetry={() => void history.refresh()}
              />
            ) : null
          }
          /* No Fee column. No fee exists anywhere in the system — not a
             column, not an engine calculation — and `price × qty × 0.0004`
             would be an invented number in a table of real ones (D4). */
          head={["Time", "Market", "Side", "Price", "Qty", "Role"]}
          isEmpty={fills.length === 0}
          empty={
            <EmptyState
              icon={ListIcon}
              title="No fills yet"
              description="Every execution is recorded here, with the side you were on."
            />
          }
          footer={
            history.loadMore ? (
              <div className="flex justify-center p-3">
                <Button
                  intent="neutral"
                  size="sm"
                  loading={history.loadingMore}
                  disabled={history.loadingMore}
                  onClick={() => void history.loadMore?.()}
                >
                  Load older fills
                </Button>
              </div>
            ) : null
          }
        >
          {fills.map((f) => (
            /* `id + role`, not `id`: a self-trade puts this account on both
               sides of one fill and both rows are trades it made. */
            <tr key={`${f.id}-${f.role}`} className="hover:bg-surface-hover">
              <Td first className="text-text-tertiary">
                {formatDateTime(f.createdAt)}
              </Td>
              <Td className="text-text-primary">
                {f.marketSlug ?? f.market?.slug ?? "—"}
              </Td>
              <Td>
                {/* The account's OWN side, derived server-side from whichever
                    of the two orders belongs to it. The same row reads the
                    other way round to the counterparty. */}
                <Side side={f.side} size="sm" />
              </Td>
              <Td>
                {f.market
                  ? formatNumber(f.price, f.market.priceDecimals)
                  : f.price}
              </Td>
              <Td>
                {f.market ? formatNumber(f.qty, f.market.sizeDecimals) : f.qty}
              </Td>
              {/* `role` is not a direction, so it gets no directional colour. */}
              <Td className="text-text-secondary">{f.role}</Td>
            </tr>
          ))}
        </TabPanel>

        <TabPanel
          value="balances"
          head={["Asset", "Total", "Available", "In orders"]}
          loading={account.status === "loading"}
          /*
           * The one tab that had no error branch (Phase 14 audit). A failed
           * balances read left `loading` false, `isEmpty` false — it is
           * guarded on `status === "ready"` — and so rendered the table with
           * no rows in it: a header row over nothing, which reads as an
           * account holding no collateral. That is a claim about someone's
           * money made out of a request that failed.
           */
          error={
            account.status === "error" ? (
              <ErrorState
                title="Couldn't load balances"
                description="Your collateral is unchanged — this is only the view."
                detail={account.error}
                onRetry={account.retry}
              />
            ) : null
          }
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
          loading={historyLoading}
          error={
            history.status === "error" ? (
              <ErrorState
                title="Couldn't load order history"
                description="Your orders are unaffected — this is only the view."
                detail={history.error}
                onRetry={() => void history.refresh()}
              />
            ) : null
          }
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
          isEmpty={historyOrders.length === 0}
          empty={
            <EmptyState
              icon={ListIcon}
              title="No order history"
              description="Filled and cancelled orders are archived here."
            />
          }
        >
          {historyOrders.map((o) => (
            <tr key={o.id} className="hover:bg-surface-hover">
              <Td first className="text-text-tertiary">
                {/* When it was PLACED. `updatedAt` moves every time db-writer
                    touches the row, so it is a fact about the pipeline, not
                    about the order. */}
                {formatDateTime(o.createdAt)}
              </Td>
              <Td>
                <span className="font-mono text-text-tertiary">
                  {truncateId(o.id)}
                </span>
              </Td>
              <Td className="text-text-primary">{o.market.slug}</Td>
              <Td>
                <Side side={o.positionType} size="sm" />
              </Td>
              <Td className="text-text-secondary">{o.orderType}</Td>
              <Td>
                {/* NEVER `orders.price` for a market order — that column holds
                    the 0 the client sent, and nothing writes the executed
                    price back (G29). `historyPrice` gives the volume-weighted
                    average of its fills, or null when there are none. */}
                {o.displayPrice === null
                  ? "—"
                  : formatNumber(o.displayPrice, o.market.priceDecimals)}
              </Td>
              <Td>{formatNumber(o.qty, o.market.sizeDecimals)}</Td>
              <Td className="text-text-secondary">
                {formatNumber(o.filledQty, o.market.sizeDecimals)}
              </Td>
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

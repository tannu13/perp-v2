"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatNumber, formatUsd } from "@/lib/format";
import type { Market } from "@/lib/markets";
import {
  AlertTriangleIcon,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  NumericInput,
  SegmentedControl,
  Tooltip,
} from "@/components/ui";
import { LeverageSlider } from "@/components/ui/leverage-slider";
import { useFillToast } from "./fill-toast";
import { useAccount } from "@/lib/account";
import { createOrder } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import {
  buildOrderPayload,
  outcomeFromResult,
  rejectionMessage,
  type TicketDraft,
} from "./order-payload";

/** Opening leverage, clamped per market — see the state below. */
const DEFAULT_LEVERAGE = 5;

/**
 * Truncates toward zero at `decimals` and returns the fixed-width string the
 * inputs hold. Rounding up here would spend money the account does not have.
 */
function floorTo(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return (0).toFixed(decimals);
  const scale = 10 ** decimals;
  return (Math.floor(value * scale) / scale).toFixed(decimals);
}

/**
 * Order ticket.
 *
 * Mirrors `CreateOrderSchema` in @repo/shared exactly — a discriminated union
 * where a limit order carries `price` with `slippage: 0`, and a market order
 * carries `slippage` with `price: 0`. Keeping the form shaped like the wire
 * contract means no translation layer and no chance of drift.
 */
export function OrderForm({
  market,
  lastPrice,
  bestBid = null,
  bestAsk = null,
  price,
  onPriceChange,
  className,
}: {
  market: Market;
  lastPrice: number | null;
  /**
   * Top of book, for sizing a MARKET order.
   *
   * A market order has no price of its own, so the margin the ticket sends has
   * to be estimated from something. The last trade was the only candidate while
   * the feed was simulated and always had one; a real feed does not — a market
   * that has never traded has `lastPrice: null` forever, and the ticket used to
   * respond by disabling its own submit button with no explanation.
   *
   * The book is the better basis anyway: a market buy lifts the best ask, not
   * whatever last printed. Both sides are accepted because either one is a real
   * quoted price and a rough margin estimate off the far side beats refusing to
   * submit — the engine validates the margin it is sent regardless.
   */
  bestBid?: number | null;
  bestAsk?: number | null;
  price: string;
  onPriceChange: (next: string) => void;
  className?: string;
}) {
  const account = useAccount();
  /**
   * Buying power is free collateral, not equity: margin already locked in
   * resting orders and open positions cannot back a new one.
   */
  const balance =
    account.status === "ready" ? Number.parseFloat(account.data.available) : 0;

  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [qty, setQty] = useState("");
  /**
   * Whole percent. `slippage` is an `integer` column and the engine reads it as
   * one — this used to default to "0.5", which is not a value the system can
   * hold. The input refuses a decimal point rather than rounding one away.
   */
  const [slippage, setSlippage] = useState("1");
  // Never open above the market's own cap: ETH allows 3x, and a default of 5
   // would have put the slider past its maximum on first render.
  const [leverage, setLeverage] = useState(() =>
    Math.min(DEFAULT_LEVERAGE, market.maxLeverage),
  );
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** The engine's own reason for refusing the last submission. */
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * An infrastructure failure, kept apart from `submitError`.
   *
   * `submitError` renders on the Quantity field, and that placement is
   * deliberate: every reason the ENGINE gives is answered by changing the size
   * or the price. "The matching engine is not responding" is answered by
   * neither, and an error on the quantity input would send the user to edit a
   * number that was never wrong. §7.4 routes infrastructure failures to a
   * panel-level message instead, which is what this is; the retry is the Buy
   * button directly under it.
   */
  const [stalled, setStalled] = useState<string | null>(null);
  const fillToast = useFillToast();

  // The ticket outlives a market switch in some layouts; the cap must not.
  useEffect(() => {
    setLeverage((current) => Math.min(current, market.maxLeverage));
  }, [market.maxLeverage]);

  /** See `bestBid`/`bestAsk`: the book first, the last trade as a fallback. */
  const marketBasis =
    side === "LONG" ? (bestAsk ?? bestBid ?? lastPrice) : (bestBid ?? bestAsk ?? lastPrice);
  const effectivePrice =
    orderType === "limit" ? Number.parseFloat(price) || 0 : (marketBasis ?? 0);
  const quantity = Number.parseFloat(qty) || 0;
  const notional = effectivePrice * quantity;
  const margin = leverage > 0 ? notional / leverage : 0;

  const error = useMemo(() => {
    if (quantity <= 0) return null;
    if (margin > balance) return "Insufficient margin for this size.";
    if (orderType === "limit" && effectivePrice <= 0)
      return "Limit price must be above 0.";
    if (orderType === "market" && effectivePrice <= 0)
      // Nothing is quoted on either side and nothing has ever traded, so there
      // is no honest basis for the margin this would lock. Said out loud,
      // because a disabled button with no reason is the worse failure.
      return "No price for this market yet — nothing is quoted and nothing has traded.";
    return null;
  }, [quantity, margin, balance, orderType, effectivePrice]);

  const canSubmit = quantity > 0 && !error && effectivePrice > 0;

  /**
   * Any edit invalidates the last rejection: "User does not have available
   * margin" stops being true the moment the quantity changes, and a stale
   * server error under a field the user has since fixed is worse than none.
   */
  const clearRejection = () => {
    setSubmitError(null);
    setStalled(null);
  };
  const changeQty = (next: string) => {
    clearRejection();
    setQty(next);
  };

  /**
   * Places the order and reports what the engine actually did.
   *
   * `POST /order` is synchronous through the matching engine: the match result
   * comes back in this response, so the outcome shown here is the engine's, not
   * an optimistic guess. The private WebSocket channel (Phase 13) is needed for
   * the COUNTERPARTY's fill — a resting order of ours being hit later — not for
   * the submitter's, which is why this path can be honest without it.
   */
  const submitOrder = async () => {
    // G24: `POST /order` is not idempotent — the correlation id is minted
    // server-side, after the row is inserted — so a second submission creates a
    // second order. The button is disabled for the duration and this re-checks
    // it anyway, because `loading` is a render away and a double click is not.
    if (submitting || !canSubmit) return;

    const draft: TicketDraft = {
      marketSlug: market.slug,
      side,
      orderType,
      price,
      slippage,
      qty,
      margin,
    };

    setSubmitting(true);
    setSubmitError(null);
    setStalled(null);

    try {
      const result = await createOrder(buildOrderPayload(draft));
      const outcome = outcomeFromResult(result, draft);

      setConfirming(false);
      fillToast({
        orderId: result.orderId,
        side,
        status: outcome.status,
        qty: outcome.qty,
        price: outcome.price,
        market,
      });
      setQty("");
      /**
       * Nothing is refreshed here any more.
       *
       * This submission moved collateral, the Open-orders list and — if it
       * filled — a position, and until Phase 13 the ticket had to tell all
       * three so itself. The engine now publishes every one of those as an
       * absolute event on the private channel, and each provider owns applying
       * its own. Three fan-outs over three markets, gone.
       *
       * The toast above stays response-driven on purpose: `POST /order` is
       * synchronous through the matching engine, so this is the engine's own
       * outcome one hop earlier than the socket could deliver it, and it is
       * still right when ws-server is not. `FillNotifications` deliberately
       * skips the taker fills of an order the account placed, so there is
       * exactly one confirmation.
       */
    } catch (err) {
      // A 401 is already being turned into a sign-out and a redirect by the
      // interceptor; a rejection toast on the way out would be noise.
      if (err instanceof ApiError && err.isSilent) return;

      /**
       * A refusal and a silence are different facts and are reported as
       * different outcomes (Phase 14).
       *
       * `POST /order` inserts the row and pushes it onto the Redis stream
       * before the engine sees it, so a 503 `ENGINE_TIMEOUT` — or a network
       * failure after the request left — means the order may be resting, or
       * filling, right now. Announcing "Rejected" there would be the client
       * stating an outcome nobody told it, on the exact surface where being
       * wrong costs money: the obvious response to a rejection is to place the
       * order again.
       */
      const unknown = err instanceof ApiError && err.isOutcomeUnknown;
      const reason =
        err instanceof ApiError && err.isOutcomeUnknown
          ? `${err.message} Check Open orders before placing it again.`
          : rejectionMessage(err);

      if (unknown) setStalled(reason);
      else setSubmitError(reason);
      setConfirming(false);
      fillToast({
        // No order id either way: a rejected order never became one, and an
        // unanswered request never told us the id of the one it may have made.
        side,
        status: unknown ? "unknown" : "rejected",
        qty,
        market,
        reason,
      });
    } finally {
      setSubmitting(false);
    }
  };

  /** Sets size from a percentage of available margin at current leverage. */
  const setPct = (pct: number) => {
    if (effectivePrice <= 0) return;
    const usable = (balance * pct) / 100;
    // FLOOR, not round. `toFixed` rounds half up, so "100%" routinely produced
    // a quantity whose margin was a fraction of a cent ABOVE the balance and
    // the ticket immediately called it insufficient.
    clearRejection();
    setQty(floorTo((usable * leverage) / effectivePrice, market.sizeDecimals));
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <SegmentedControl
        aria-label="Order side"
        intent="directional"
        fullWidth
        options={[
          { value: "LONG", label: "Buy / Long" },
          { value: "SHORT", label: "Sell / Short" },
        ]}
        value={side}
        onValueChange={(next) => {
          clearRejection();
          setSide(next);
        }}
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
        onValueChange={(next) => {
          clearRejection();
          setOrderType(next);
        }}
      />

      <div className="flex items-center justify-between text-body-sm">
        <span className="text-text-tertiary">Available</span>
        <span className="text-num-md tnum text-text-primary">
          {formatUsd(balance)}
        </span>
      </div>

      {/* --- price / size group ------------------------------------------- */}
      {orderType === "limit" ? (
        <Field label="Limit price">
          <NumericInput
            value={price}
            onValueChange={(next) => {
              clearRejection();
              onPriceChange(next);
            }}
            step={market.tickSize}
            min={0}
            suffix={market.quote}
            inputSize="lg"
          />
        </Field>
      ) : (
        <Field
          label="Max slippage"
          hint="Whole percent. Anything past the band is cancelled, not filled."
        >
          <NumericInput
            value={slippage}
            onValueChange={(next) => {
              clearRejection();
              setSlippage(next);
            }}
            integerOnly
            step={1}
            min={1}
            suffix="%"
            inputSize="lg"
          />
        </Field>
      )}

      {/* The percentage row sets QUANTITY, not leverage. It sits inside the
          quantity group with no gap so the two read as one control — when it
          floated between Quantity and Leverage it was mistaken for a duplicate
          of the leverage slider. */}
      <div className="flex flex-col gap-1.5">
        {/* The server's rejection reason lands here rather than in its own
            banner: every reason the engine gives — no margin, unsupported
            leverage, nothing to match — is answered by changing the size or the
            price, and this is the field the answer is typed into. */}
        <Field label="Quantity" error={error ?? submitError ?? undefined}>
          <NumericInput
            value={qty}
            onValueChange={changeQty}
            step={10 ** -market.sizeDecimals}
            min={0}
            suffix={market.base}
            inputSize="lg"
          />
        </Field>

        <div className="flex items-center gap-2">
          <span className="shrink-0 text-micro whitespace-nowrap text-text-disabled">
            % of buying power
          </span>
          <div className="flex flex-1 gap-1">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPct(p)}
                className={cn(
                  "flex-1 rounded-sm border border-border-subtle py-1 text-micro text-text-tertiary",
                  "transition-colors duration-fast hover:border-border-strong hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* --- risk group ---------------------------------------------------- */}
      <div className="border-t border-border-subtle pt-3">
        <LeverageSlider
          value={leverage}
          onChange={(next) => {
            clearRejection();
            setLeverage(next);
          }}
          max={market.maxLeverage}
        />
      </div>

      {/* --- summary ------------------------------------------------------- */}
      <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3 text-body-sm">
        <div className="flex justify-between">
          <span className="text-text-tertiary">Order value</span>
          <span className="text-num-md tnum text-text-primary">
            {formatUsd(notional)}
          </span>
        </div>
        <div className="flex justify-between">
          <Tooltip content="Collateral locked for this position at the selected leverage.">
            <span className="cursor-help border-b border-dashed border-border-strong text-text-tertiary">
              Margin required
            </span>
          </Tooltip>
          <span className="text-num-md tnum text-text-primary">
            {formatUsd(margin)}
          </span>
        </div>
      </div>

      {stalled && (
        /*
          Above the button, not below it: it is the reason not to press the
          button again yet. `role="alert"` so it is announced — the toast that
          carries the same words is at the app root and a screen-reader user
          working through the ticket has no reason to be there.
        */
        <p
          role="alert"
          className="flex gap-1.5 rounded-md border border-border-strong bg-surface-inset px-2.5 py-2 text-caption text-text-secondary"
        >
          <AlertTriangleIcon className="mt-px size-3.5 shrink-0 text-warning" />
          {stalled}
        </p>
      )}

      <Button
        intent={side === "LONG" ? "buy" : "sell"}
        size="lg"
        fullWidth
        disabled={!canSubmit}
        onClick={() => setConfirming(true)}
      >
        {side === "LONG" ? "Buy" : "Sell"} {qty || "0"} {market.base}
      </Button>

      {/* Post-only and reduce-only exist in NEITHER `CreateOrderSchema` nor the
          matching engine. They are shown disabled rather than deleted because
          the ticket should say what the exchange cannot do — a flag that
          silently vanished would read as a UI that never had it, and sending a
          field the server ignores would be worse than both. */}
      <details className="group">
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-1.5 text-caption text-text-tertiary",
            "transition-colors duration-fast hover:text-text-secondary",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          <span className="transition-transform duration-fast group-open:rotate-90">
            ›
          </span>
          Advanced
          <span className="text-text-disabled">· unavailable</span>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Checkbox label="Post only" checked={false} disabled readOnly />
            <Checkbox label="Reduce only" checked={false} disabled readOnly />
          </div>
          {/* Said in words, not only in a tooltip: a tooltip on a disabled
              control is unreachable by pointer and by keyboard alike. */}
          <p className="text-micro text-text-disabled">
            The matching engine does not support order flags yet.
          </p>
        </div>
      </details>

      {/* Not dismissable mid-flight: the request is already with the engine and
          closing the dialog would suggest it had been called off. */}
      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          if (submitting) return;
          setConfirming(next);
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm order</DialogTitle>
          <DialogDescription>
            This submits a {orderType} order to the matching engine. It cannot
            be recalled once filled.
          </DialogDescription>

          <dl className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-inset p-3 text-body-sm">
            {[
              ["Market", market.slug],
              ["Side", side],
              ["Type", orderType],
              [
                orderType === "limit" ? "Limit price" : "Est. price",
                formatNumber(effectivePrice, market.priceDecimals),
              ],
              // The band is part of what is being agreed to, so it is stated
              // here rather than left behind in a collapsed field.
              ...(orderType === "market"
                ? [["Max slippage", `${slippage || "1"}%`]]
                : []),
              ["Quantity", `${qty || "0"} ${market.base}`],
              ["Order value", formatUsd(notional)],
              ["Margin", `${formatUsd(margin)} at ${leverage}x`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-text-tertiary">{k}</dt>
                <dd className="text-num-md tnum text-text-primary">{v}</dd>
              </div>
            ))}
          </dl>

          {/* `*:flex-1` splits the row evenly. `fullWidth` (w-full) cannot be
              used here: two w-full items in a flex row each claim 100% of the
              container, so together they overflowed past the dialog edge. */}
          <div className="flex gap-2 *:flex-1">
            <DialogClose asChild>
              <Button intent="neutral" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            {/* Re-checks `canSubmit` rather than trusting that the dialog could
                only have been opened while it was true. The ticket stays live
                behind the dialog — a market order's price tracks the feed — so
                the guard belongs at the point of submission, not only at the
                point the dialog opened. */}
            <Button
              intent={side === "LONG" ? "buy" : "sell"}
              disabled={!canSubmit || submitting}
              loading={submitting}
              onClick={submitOrder}
            >
              Confirm {side === "LONG" ? "buy" : "sell"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

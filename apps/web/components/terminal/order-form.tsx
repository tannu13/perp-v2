"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatNumber, formatUsd } from "@/lib/format";
import type { Market } from "@/lib/markets";
import {
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
  price,
  onPriceChange,
  balance = 2521,
  className,
}: {
  market: Market;
  lastPrice: number | null;
  price: string;
  onPriceChange: (next: string) => void;
  balance?: number;
  className?: string;
}) {
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [qty, setQty] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [leverage, setLeverage] = useState(5);
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fillToast = useFillToast();

  const effectivePrice =
    orderType === "limit" ? Number.parseFloat(price) || 0 : (lastPrice ?? 0);
  const quantity = Number.parseFloat(qty) || 0;
  const notional = effectivePrice * quantity;
  const margin = leverage > 0 ? notional / leverage : 0;

  const error = useMemo(() => {
    if (quantity <= 0) return null;
    if (margin > balance) return "Insufficient margin for this size.";
    if (orderType === "limit" && effectivePrice <= 0)
      return "Limit price must be above 0.";
    return null;
  }, [quantity, margin, balance, orderType, effectivePrice]);

  const canSubmit = quantity > 0 && !error && effectivePrice > 0;

  /**
   * TODO(api): POST /order with the CreateOrderSchema payload, then let the
   * private ws-server channel deliver the fill. The decision on record is that
   * fills are PUSHED, not polled — so the real version fires no toast here; it
   * subscribes, and the toast comes from the socket. This local call stands in
   * for that push so the confirmation path is built and reviewable now.
   */
  const submitOrder = async () => {
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 450));
    setSubmitting(false);
    setConfirming(false);

    fillToast({
      orderId: `${market.slug.toLowerCase()}-${Date.now().toString(16)}`,
      side,
      // A limit order rests; only a market order is filled on submission.
      status: orderType === "market" ? "filled" : "partial",
      qty,
      price: effectivePrice.toFixed(market.priceDecimals),
      market,
    });
    setQty("");
  };

  /** Sets size from a percentage of available margin at current leverage. */
  const setPct = (pct: number) => {
    if (effectivePrice <= 0) return;
    const usable = (balance * pct) / 100;
    setQty(((usable * leverage) / effectivePrice).toFixed(market.sizeDecimals));
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
            onValueChange={onPriceChange}
            step={market.tickSize}
            min={0}
            suffix={market.quote}
            inputSize="lg"
          />
        </Field>
      ) : (
        <Field label="Max slippage" hint="Order is rejected beyond this band.">
          <NumericInput
            value={slippage}
            onValueChange={setSlippage}
            step={0.1}
            min={0}
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
        <Field label="Quantity" error={error ?? undefined}>
          <NumericInput
            value={qty}
            onValueChange={setQty}
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
          onChange={setLeverage}
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

      <Button
        intent={side === "LONG" ? "buy" : "sell"}
        size="lg"
        fullWidth
        disabled={!canSubmit}
        onClick={() => setConfirming(true)}
      >
        {side === "LONG" ? "Buy" : "Sell"} {qty || "0"} {market.base}
      </Button>

      {/* Order flags are for experienced users and were adding two more rows to
          an already dense rail. Collapsed by default; the summary line keeps any
          active flag visible without expanding. */}
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
          {(postOnly || reduceOnly) && (
            <span className="text-text-disabled">
              · {[postOnly && "post only", reduceOnly && "reduce only"]
                .filter(Boolean)
                .join(", ")}
            </span>
          )}
        </summary>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          <Checkbox
            label="Post only"
            checked={postOnly}
            disabled={orderType === "market"}
            onChange={(e) => setPostOnly(e.target.checked)}
          />
          <Checkbox
            label="Reduce only"
            checked={reduceOnly}
            onChange={(e) => setReduceOnly(e.target.checked)}
          />
        </div>
      </details>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>Confirm order</DialogTitle>
          <DialogDescription>
            This submits a {orderType} order to the matching engine. It cannot be
            recalled once filled.
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
              <Button intent="neutral">
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
              disabled={!canSubmit}
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

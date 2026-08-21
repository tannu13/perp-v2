"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/format";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  NumericInput,
} from "@/components/ui";

/**
 * Deposit / on-ramp.
 *
 * Maps to `POST /order/onramp`, whose only field is `{ amount }` — validated
 * server-side by `OnRampSchema` as a positive number. The amount is kept as a
 * string the whole way through, like every other money value in the app.
 *
 * `primary`, not `buy`: adding collateral is not a direction. Green here would
 * read as a long. See the directional-colour rule in CLAUDE.md.
 */
const PRESETS = [100, 500, 1000, 5000];

/**
 * Controlled, with no trigger of its own.
 *
 * It used to own both the button and the dialog, which was fine while the market
 * bar was the only chrome. Now the global header opens it from two places — the
 * Deposit button and the account menu — and a self-contained trigger cannot
 * serve both. `DepositButton` below restores the one-line usage for anywhere
 * that just wants a button.
 */
export function DepositDialog({
  balance = 2521,
  open,
  onOpenChange,
}: {
  balance?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);

  const value = Number.parseFloat(amount) || 0;
  const error =
    amount !== "" && value <= 0 ? "Amount must be greater than 0." : undefined;
  const canSubmit = value > 0 && !error;

  const submit = async () => {
    setPending(true);
    // TODO(api): POST /order/onramp { amount } with the bearer token, then
    // refetch GET /order/equity/balances. Deliberately not wired — there is no
    // API client yet and the backend stack is not running.
    await new Promise((r) => setTimeout(r, 600));
    setPending(false);
    onOpenChange(false);
    setAmount("");
  };

  return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) setAmount("");
        }}
      >
        <DialogContent>
          <DialogTitle>Deposit funds</DialogTitle>
          <DialogDescription>
            Adds collateral to your cross-margin account. It becomes available
            for new positions immediately.
          </DialogDescription>

          <div className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-inset px-3 py-2 text-body-sm">
            <span className="text-text-tertiary">Current balance</span>
            <span className="text-num-md tnum text-text-primary">
              {formatUsd(balance)}
            </span>
          </div>

          <Field label="Amount" error={error}>
            <NumericInput
              value={amount}
              onValueChange={setAmount}
              step={100}
              min={0}
              suffix="USD"
              inputSize="lg"
              autoFocus
            />
          </Field>

          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(String(p))}
                className={cn(
                  "flex-1 rounded-sm border border-border-subtle py-1.5 text-micro text-text-tertiary",
                  "transition-colors duration-fast hover:border-border-strong hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                )}
              >
                +{p.toLocaleString("en-US")}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-border-subtle pt-3 text-body-sm">
            <span className="text-text-tertiary">New balance</span>
            <span className="text-num-md tnum text-text-primary">
              {formatUsd(balance + value)}
            </span>
          </div>

          <div className="flex gap-2 *:flex-1">
            <DialogClose asChild>
              <Button intent="neutral">Cancel</Button>
            </DialogClose>
            <Button
              intent="primary"
              disabled={!canSubmit}
              loading={pending}
              onClick={submit}
            >
              Deposit {value > 0 ? formatUsd(value) : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
  );
}

/** Button plus dialog, for callers that do not need to open it from elsewhere. */
export function DepositButton({
  balance,
  className,
  size = "sm",
}: {
  balance?: number;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* `primary`, not `buy` — adding collateral is not a direction. */}
      <Button
        intent="primary"
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        Deposit
      </Button>
      <DepositDialog balance={balance} open={open} onOpenChange={setOpen} />
    </>
  );
}

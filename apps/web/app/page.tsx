import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-2">
        <span className="text-micro uppercase text-text-tertiary">
          Perp&nbsp;v2
        </span>
        <h1 className="text-heading-lg text-text-primary">
          Design system foundation
        </h1>
        <p className="text-body-md text-text-secondary">
          Phase 1 tokens are live. Layout and components come next.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="h-9 rounded-md bg-buy px-4 text-body-sm font-semibold text-text-inverse transition-colors duration-fast hover:bg-buy-hover">
          Buy / Long
        </button>
        <button className="h-9 rounded-md bg-sell px-4 text-body-sm font-semibold text-text-inverse transition-colors duration-fast hover:bg-sell-hover">
          Sell / Short
        </button>
        <button className="h-9 rounded-md border border-border-strong bg-surface-raised px-4 text-body-sm text-text-primary transition-colors duration-fast hover:bg-surface-hover">
          Secondary
        </button>
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-e1">
        <div className="mb-2 flex justify-between text-micro uppercase text-text-tertiary">
          <span>Price (USD)</span>
          <span>Size (SOL)</span>
        </div>
        {[
          ["205.01", "41.48", "sell"],
          ["205.00", "6.39", "buy"],
          ["204.98", "7.35", "buy"],
        ].map(([price, size, side]) => (
          <div
            key={price}
            className="flex h-[22px] items-center justify-between text-num-md tnum"
          >
            <span
              className={side === "buy" ? "text-buy-text" : "text-sell-text"}
            >
              {price}
            </span>
            <span className="text-text-secondary">{size}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4">
        <Link
          href="/design-system"
          className="text-body-sm text-text-link hover:underline"
        >
          Design system &amp; build log &rarr;
        </Link>
        <Link
          href="/trade/SOL-USD"
          className="text-body-sm text-text-tertiary hover:underline"
        >
          Terminal (not built yet)
        </Link>
      </div>
    </main>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { cn } from "@/lib/cn";
import { MARKETS, DEFAULT_MARKET } from "@/lib/markets";
import {
  ArrowUpRightIcon,
  Badge,
  buttonVariants,
  Delta,
  LogoMark,
  Seam,
  Side,
  StatusDot,
  TextLink,
} from "@/components/ui";
import { SiteHeader } from "@/components/chrome/site-header";

export const metadata: Metadata = {
  title: "Perp — Event-driven perpetual futures",
  description:
    "A perpetual futures exchange built on Redis Streams and a single in-memory matching engine, with a design system built for reading numbers under pressure.",
};

/**
 * Landing page.
 *
 * The one route in the product allowed to use the `--text-display-*` scale —
 * everything inside the terminal tops out at `heading-lg`, because display type
 * in a trading UI steals space from the numbers. Marketing is the exception the
 * scale was defined for.
 *
 * Static by design. It would be easy to wire `useMarketFeed` in here for live
 * prices, but that opens a socket per market on a page whose whole job is to
 * get out of the way, and the feed falls back to a simulator when the backend
 * is absent — a landing page quietly showing invented prices is worse than one
 * showing none.
 */

/* The pipeline this project actually is, in the order an order travels it. */
const PIPELINE = [
  { name: "REST API", detail: "validates, signs, pushes", port: ":3000" },
  { name: "Redis Streams", detail: "the only transport", port: null },
  { name: "Matching engine", detail: "in-memory, single instance", port: null },
  { name: "Fan-out", detail: "ws-server + db-writer", port: ":3010" },
];

const PRINCIPLES = [
  {
    title: "Green means long. Nothing else.",
    body: "The primary action is blue so green never reads as “confirm”. Direction always carries a word or a sign too — roughly 8% of men cannot separate the pair.",
  },
  {
    title: "Money is strings, end to end.",
    body: "Prices and sizes arrive as strings and stay strings. Nothing in the UI parses a quantity into a float and hands it back to the API.",
  },
  {
    title: "Every opposition is a seam.",
    body: "Bids against asks, long against short, margin used against free. They grow toward each other and meet at a join whose position is the ratio.",
  },
  {
    title: "Six states on every control.",
    body: "Default, hover, focus, active, disabled, error — plus loading and empty on anything that waits on a network. Designed, not discovered in production.",
  },
];

function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-2.5">
      <span className="font-mono text-micro uppercase text-text-tertiary">
        {eyebrow}
      </span>
      <h2 className="text-balance text-heading-lg text-text-primary">{title}</h2>
      {children && (
        <p className="max-w-[58ch] text-body-md leading-relaxed text-text-secondary">
          {children}
        </p>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-base">
      <SiteHeader />

      <main className="flex-1">
        {/* ------------------------------------------------------------ hero -- */}
        <section className="mx-auto w-full max-w-[1100px] px-5 pt-16 pb-20 lg:px-8 lg:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="flex flex-col items-start gap-6">
              <span className="flex items-center gap-2 rounded-full border border-border-subtle bg-surface-raised px-3 py-1">
                <StatusDot intent="online" pulse label="Engine status" />
                <span className="font-mono text-micro uppercase text-text-tertiary">
                  Sub-millisecond matching
                </span>
              </span>

              <h1 className="text-balance text-display-md text-text-primary lg:text-display-lg">
                Perpetual futures, held in balance.
              </h1>

              <p className="max-w-[52ch] text-body-lg leading-relaxed text-text-secondary">
                An event-driven exchange: every order crosses one in-memory
                matching engine, and every fill fans out over Redis Streams to
                the socket, the database and your screen.
              </p>

              {/* `buttonVariants` on a Link rather than a Button with `asChild`.
                  Button is a real <button> and has no Slot — and adding one for
                  two navigation links would mean a component that is sometimes
                  a button and sometimes an anchor, which is how you end up with
                  a "button" that ignores Cmd-click. */}
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/trade/${DEFAULT_MARKET.slug}`}
                  className={buttonVariants({ intent: "primary", size: "lg" })}
                >
                  Open the terminal
                </Link>
                <Link
                  href="/design-system"
                  className={buttonVariants({ intent: "neutral", size: "lg" })}
                >
                  Read the design system
                </Link>
              </div>
            </div>

            {/*
              The signature, at hero scale.
              Long versus short open interest is the most honest thing this
              product can show above the fold: it is the market's actual balance,
              and it is the same primitive the order book's middle uses.
            */}
            <div className="rounded-xl border border-border-subtle bg-surface-raised p-6 shadow-e2">
              <div className="mb-5 flex items-center justify-between">
                <span className="font-mono text-micro uppercase text-text-tertiary">
                  Open interest
                </span>
                <Badge intent="outline" size="sm">
                  {DEFAULT_MARKET.slug}
                </Badge>
              </div>

              <Seam
                size="lg"
                left={58.4}
                right={41.6}
                leftLabel={
                  <span className="flex items-center gap-1.5">
                    <Side side="LONG" size="sm" />
                    58.4%
                  </span>
                }
                rightLabel={
                  <span className="flex items-center gap-1.5">
                    41.6%
                    <Side side="SHORT" size="sm" />
                  </span>
                }
                value="204.96"
              />

              <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-border-subtle pt-5">
                {[
                  ["24h volume", "18.49M"],
                  ["Funding", <Delta key="f" value={0.0091} percent size="sm" />],
                  ["Max leverage", `${DEFAULT_MARKET.maxLeverage}x`],
                ].map(([label, value], i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <dt className="text-micro uppercase text-text-tertiary">
                      {label}
                    </dt>
                    <dd className="text-num-md tnum text-text-primary">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- markets -- */}
        <section className="mx-auto w-full max-w-[1100px] px-5 py-16 lg:px-8">
          <SectionHeading eyebrow="Markets" title="Three markets, cross-margined">
            One collateral pool backs every position. Margin is evaluated
            against the index price from the spot feed, not the last trade on
            our own book.
          </SectionHeading>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MARKETS.map((m) => (
              <Link
                key={m.id}
                href={`/trade/${m.slug}`}
                className={cn(
                  "group flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-raised p-4",
                  "transition-colors duration-fast",
                  "hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-full bg-surface-modal text-micro font-semibold text-text-secondary">
                      {m.base.slice(0, 2)}
                    </span>
                    <span className="text-body-md font-semibold text-text-primary">
                      {m.slug}
                    </span>
                  </span>
                  <Badge intent="outline" size="sm">
                    {m.maxLeverage}x
                  </Badge>
                </div>

                <div className="flex items-center justify-between text-caption text-text-tertiary">
                  <span>
                    Tick {m.tickSize} · {m.priceDecimals} dp
                  </span>
                  <span className="flex items-center gap-1 text-text-link opacity-0 transition-opacity duration-fast group-hover:opacity-100">
                    Trade
                    <ArrowUpRightIcon className="size-3.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- architecture -- */}
        <section className="border-y border-border-subtle bg-surface-raised">
          <div className="mx-auto w-full max-w-[1100px] px-5 py-16 lg:px-8">
            <SectionHeading
              eyebrow="Architecture"
              title="One path, and everything reads from it"
            >
              The engine is the only writer of truth and it holds the book in
              memory. Persistence and broadcast are consumers of the same
              stream, so the database can fall behind without the market
              stopping.
            </SectionHeading>

            <ol className="grid gap-3 md:grid-cols-4">
              {PIPELINE.map((stage, i) => (
                <li
                  key={stage.name}
                  className="relative flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-base p-4"
                >
                  <span className="font-mono text-micro text-text-disabled">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-body-md font-medium text-text-primary">
                    {stage.name}
                  </span>
                  <span className="text-caption leading-relaxed text-text-tertiary">
                    {stage.detail}
                  </span>
                  {stage.port && (
                    <span className="mt-auto pt-1 font-mono text-micro text-text-disabled">
                      {stage.port}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------ principles -- */}
        <section className="mx-auto w-full max-w-[1100px] px-5 py-16 lg:px-8">
          <SectionHeading
            eyebrow="Design system"
            title="Rules a trading screen has to keep"
          >
            The interface is built from two token layers and about twenty atoms.
            Every rule below is enforced in the components, not in a document.
          </SectionHeading>

          <div className="grid gap-3 md:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <div
                key={p.title}
                className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised p-5"
              >
                <h3 className="text-body-md font-semibold text-text-primary">
                  {p.title}
                </h3>
                <p className="text-body-sm leading-relaxed text-text-secondary">
                  {p.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-4">
            <TextLink href="/design-system">Tokens &amp; build log →</TextLink>
            <TextLink href="/design-system/components" intent="subtle">
              Component library →
            </TextLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 lg:px-8">
          <span className="flex items-center gap-2">
            <LogoMark className="size-4" />
            <span className="text-body-sm font-semibold text-text-primary">
              Perp
            </span>
          </span>
          <span className="text-caption text-text-tertiary">
            Bun · Redis Streams · Postgres · Next.js
          </span>
          <span className="ml-auto font-mono text-micro text-text-disabled">
            Dark only. A light theme is a Layer 2 remap.
          </span>
        </div>
      </footer>
    </div>
  );
}

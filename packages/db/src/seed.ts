/**
 * Idempotent market seed.
 *
 * Nothing in this repo used to insert into `markets`, but `POST /order` looks a
 * market up there by slug before it will accept an order — so a fresh database
 * rejects every order with "Market does not exist". This closes that gap and is
 * part of stack bring-up, not a migration: migrations own schema, this owns the
 * three rows the engine's in-memory orderbooks are keyed by.
 *
 * Safe to run repeatedly. A conflict on the primary key updates the mutable
 * columns, so re-running after a slug change converges instead of failing.
 */
import { sql } from "drizzle-orm";
import db from "./index";
import { markets } from "./schema";
import { MARKET_LIST } from "./markets";

export async function seedMarkets() {
  const rows = MARKET_LIST.map((m) => ({
    id: m.id,
    slug: m.slug,
    base: m.base,
    quote: m.quote,
    priceDecimals: m.priceDecimals,
    sizeDecimals: m.sizeDecimals,
    tickSize: m.tickSize,
    maxLeverage: m.maxLeverage,
    binanceSymbol: m.binanceSymbol,
  }));

  await db
    .insert(markets)
    .values(rows)
    .onConflictDoUpdate({
      target: markets.id,
      // `excluded` is the row proposed for insertion — i.e. take the new value.
      // Every column the definition owns is refreshed, so changing a tick size
      // or a leverage cap in `markets.ts` and re-running is the whole workflow.
      set: {
        slug: sql`excluded."slug"`,
        base: sql`excluded."base"`,
        quote: sql`excluded."quote"`,
        priceDecimals: sql`excluded."price_decimals"`,
        sizeDecimals: sql`excluded."size_decimals"`,
        tickSize: sql`excluded."tick_size"`,
        maxLeverage: sql`excluded."max_leverage"`,
        binanceSymbol: sql`excluded."binance_symbol"`,
      },
    });

  return rows;
}

if (import.meta.main) {
  const rows = await seedMarkets();
  console.log(`seeded ${rows.length} markets:`);
  for (const r of rows) console.log(`  ${r.slug}  ${r.id}`);
  process.exit(0);
}

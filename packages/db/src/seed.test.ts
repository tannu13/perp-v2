import { describe, expect, it } from "bun:test";
import { MARKET_LIST } from "./markets";

/**
 * Integration cover for the seed. Skipped without a database rather than
 * failing, so `bun test` stays runnable on a machine with no stack up — but the
 * Phase 0 gate runs it with DATABASE_URL set.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb("seedMarkets (integration)", () => {
  it("is idempotent and leaves exactly one row per market", async () => {
    const { seedMarkets } = await import("./seed");
    const db = (await import("./index")).default;
    const { markets } = await import("./schema");

    await seedMarkets();
    await seedMarkets();

    const rows = await db.select().from(markets);
    expect(rows).toHaveLength(MARKET_LIST.length);

    for (const definition of MARKET_LIST) {
      const matching = rows.filter((r) => r.id === definition.id);
      expect(matching).toHaveLength(1);
      expect(matching[0]!.slug).toBe(definition.slug);
    }
  });

  it("stores slugs that POST /order can resolve", async () => {
    const db = (await import("./index")).default;
    for (const definition of MARKET_LIST) {
      // order-service resolves the `market` field of CreateOrderSchema this way.
      const found = await db.query.markets.findFirst({
        where: (m, { eq }) => eq(m.slug, definition.slug),
      });
      expect(found?.id).toBe(definition.id);
    }
  });
});

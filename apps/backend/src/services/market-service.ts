import db from "@repo/db";
import { MarketDtoSchema, type TMarketDto } from "@repo/shared";
import { AppError } from "../errors/app-error";

/**
 * The market list.
 *
 * Reads Postgres directly — no engine round trip. Market metadata is static
 * reference data, and routing it through the request/response stream would put
 * the engine's liveness in the path of a page that should render for a signed
 * -out visitor.
 */
export const createMarketService = () => {
  const getMarkets = async (): Promise<TMarketDto[]> => {
    const rows = await db.query.markets.findMany();

    return rows.map((row) => {
      const parsed = MarketDtoSchema.safeParse(row);
      if (!parsed.success) {
        /**
         * The display columns are nullable in the schema and populated by the
         * seed, so this is what an unseeded — or half-migrated — database looks
         * like. Failing here is deliberate: serving a market with a null tick
         * size would put a wrong number in front of someone placing an order.
         */
        throw new AppError(
          `Market "${row.slug}" is missing required metadata. Run: bun run --filter '@repo/db' db:seed`,
          500,
          "MARKET_METADATA_INCOMPLETE",
        );
      }
      return parsed.data;
    });
  };

  return { getMarkets };
};

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const positionTypesEnum = pgEnum("position_type", ["LONG", "SHORT"]);
export const orderTypesEnum = pgEnum("order_type", ["market", "limit"]);
export const orderStatusesEnum = pgEnum("status", [
  "pending",
  "open",
  "partially_filled",
  "filled",
  "cancelled",
]);
export type TOrderStatusesEnum = (typeof orderStatusesEnum.enumValues)[number];
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 255 }).notNull(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("user_username_unique").on(t.username)],
);

/**
 * Display and risk metadata are deliberately NULLABLE.
 *
 * They are populated by `db:seed`, not by the migration. A wrong-but-present
 * default — a tick size of 0.01 on BTC, a leverage cap of 1 — would be served
 * to the UI as if it were true; a null makes an unseeded database fail loudly
 * at the API boundary instead, naming the command that fixes it.
 */
export const markets = pgTable("markets", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 255 }).notNull(),
  imageUrl: varchar("image_url", { length: 255 }),
  base: varchar("base", { length: 16 }),
  quote: varchar("quote", { length: 16 }),
  priceDecimals: smallint("price_decimals"),
  sizeDecimals: smallint("size_decimals"),
  tickSize: varchar("tick_size", { length: 32 }),
  /** Mirrors the engine's `allowedLeverage`; both read `@repo/db/markets`. */
  maxLeverage: smallint("max_leverage"),
  binanceSymbol: varchar("binance_symbol", { length: 32 }),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  marketId: uuid("market_id")
    .notNull()
    .references(() => markets.id),
  positionType: positionTypesEnum().notNull(),
  orderType: orderTypesEnum().notNull(),
  status: orderStatusesEnum().notNull(),
  qty: varchar("qty", { length: 80 }).notNull(),
  filledQty: varchar("filled_qty", { length: 80 }).notNull(),
  price: varchar("price", { length: 80 }).notNull(),
  slippage: integer("slippage").notNull(),
  initialMargin: varchar("initial_margin", { length: 80 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * The idempotency ledger for `apps/db-writer`.
 *
 * `checkProcessedEvents` inserts the correlation id inside the same transaction
 * as the rows it guards, so a redelivered event fails on this primary key, the
 * whole write rolls back, and `setup-comms.ts` recognises the `23505` and acks
 * instead of retrying. The row IS the guard — there is no separate lookup.
 *
 * `createdAt` exists only so the table can be pruned. It grows at roughly two
 * rows per order (~540/min with the market maker quoting three books) and the
 * key is a bare uuid, so before this column there was no way to express "old
 * enough that no consumer could still replay it" and the table could only be
 * truncated with the stack down. See `prune-bots.ts` for the retention rule,
 * which is not a matter of taste: delete a row while its stream entry can still
 * be redelivered and the guard is gone.
 */
export const processedEvents = pgTable(
  "processed_events",
  {
    idempotencyKey: uuid("idempotency_key").primaryKey().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // The prune deletes by age across the whole table; without this it is a seq
  // scan over millions of rows every fifteen minutes.
  (t) => [index("processed_events_created_at_idx").on(t.createdAt)],
);

export type InsertOrderRecord = typeof orders.$inferInsert;
export const InsertOrderSchema = createInsertSchema(orders);
export type SelectOrderRecord = typeof orders.$inferSelect;
export const SelectOrderSchema = createSelectSchema(orders);

export const fills = pgTable("fills", {
  id: uuid("id").primaryKey().defaultRandom(),
  makerId: uuid("maker_id")
    .notNull()
    .references(() => users.id),
  takerId: uuid("taker_id")
    .notNull()
    .references(() => users.id),
  marketId: uuid("market_id")
    .notNull()
    .references(() => markets.id),
  qty: varchar("qty", { length: 80 }).notNull(),
  price: varchar("price", { length: 80 }).notNull(),
  makerOrderId: uuid("maker_order_id")
    .notNull()
    .references(() => orders.id),
  takerOrderId: uuid("taker_order_id")
    .notNull()
    .references(() => orders.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type InsertFillRecord = typeof fills.$inferInsert;
export const InsertFillSchema = createInsertSchema(fills);

export const userRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  makerFills: many(fills, { relationName: "maker_user_fills" }),
  takerFills: many(fills, { relationName: "taker_user_fills" }),
}));

export const marketRelations = relations(markets, ({ many }) => ({
  orders: many(orders),
  fills: many(fills),
}));

export const orderRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  market: one(markets, {
    fields: [orders.marketId],
    references: [markets.id],
  }),
  makerFills: many(fills, { relationName: "maker_order_fills" }),
  takerFills: many(fills, { relationName: "taker_order_fills" }),
}));

export const fillRelations = relations(fills, ({ one }) => ({
  maker: one(users, {
    fields: [fills.makerId],
    references: [users.id],
    relationName: "maker_user_fills",
  }),
  taker: one(users, {
    fields: [fills.takerId],
    references: [users.id],
    relationName: "taker_user_fills",
  }),
  makerOrder: one(orders, {
    fields: [fills.makerOrderId],
    references: [orders.id],
    relationName: "maker_order_fills",
  }),
  takerOrder: one(orders, {
    fields: [fills.takerOrderId],
    references: [orders.id],
    relationName: "taker_order_fills",
  }),
  market: one(markets, {
    fields: [fills.marketId],
    references: [markets.id],
  }),
}));

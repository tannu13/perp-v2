import { relations } from "drizzle-orm";
import {
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

export const processedEvents = pgTable("processed_events", {
  idempotencyKey: uuid("idempotency_key").primaryKey().notNull(),
});

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

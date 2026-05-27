import { InsertFillSchema, InsertOrderSchema } from "@repo/db/schema";
import z from "zod";

const EngineSupportedTypes = z.enum([
  "init_balance",
  "onramp",
  "create_order",
  "cancel_order",
  "get_balances",
  "get_open_positions_for_market",
  "get_closed_positions_for_market",
  "spot_price_update",
  "backup_store",
  "funding_rate_dispersal",
]);
export type TEngineSupportedTypes = z.infer<typeof EngineSupportedTypes>;

// engine requests
export const RawEngineRequestSchema = z.object({
  correlationId: z.string(),
  type: EngineSupportedTypes,
  payload: z.string(),
});
export type TRawEngineRequestSchema = z.infer<typeof RawEngineRequestSchema>;

export const EngineRequestSchema = z.object({
  correlationId: z.string(),
  type: EngineSupportedTypes,
  payload: z.record(z.string(), z.unknown()),
});
export type TEngineRequestSchema = z.infer<typeof EngineRequestSchema>;

export type TStreamEngineRequestMessage = {
  id: string;
  message: TEngineRequestSchema;
};
export type TStreamEngineRequest = {
  name: string;
  messages: TStreamEngineRequestMessage[];
}[];

// engine responses
export const RawEngineResponseSchema = z.object({
  correlationId: z.string(),
  ok: z.string(),
  data: z.string(),
  error: z.string(),
});
export type TRawEngineResponseSchema = z.infer<typeof RawEngineResponseSchema>;
export const OrderDataForWriterSchema = z.object({
  orderId: z.string(),
  userId: z.string(),
  status: z.string(),
  filledQty: z.coerce.number(),
});
export type TOrderDataForWriterSchema = z.infer<
  typeof OrderDataForWriterSchema
>;
export const WriterSchema = z.array(
  z.discriminatedUnion("table", [
    z.object({
      table: z.literal("fills"),
      data: z.array(InsertFillSchema),
    }),
    z.object({
      table: z.literal("order_updates"),
      data: z.array(OrderDataForWriterSchema),
    }),
    z.object({
      table: z.literal("order_inserts"),
      data: z.array(InsertOrderSchema),
    }),
  ]),
);
export type TWriterSchema = z.infer<typeof WriterSchema>;
export const EngineResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    correlationId: z.string().optional(),
    ok: z.literal(true),
    data: z.object({
      backend: z.record(z.string(), z.unknown()).nullable(),
      writer: WriterSchema.optional(),
    }),
    error: z.literal(""),
  }),
  z.object({
    correlationId: z.string().optional(),
    ok: z.literal(false),
    data: z.literal(""),
    error: z.string(),
  }),
]);
export type TEngineResponseSchema = z.infer<typeof EngineResponseSchema>;
export type TStreamEngineResponseMessage = {
  id: string;
  message: TEngineResponseSchema;
};
export type TStreamEngineResponse = {
  name: string;
  messages: TStreamEngineResponseMessage[];
}[];

import z from "zod";

export const CreateOrderSchema = z.discriminatedUnion("orderType", [
  z.object({
    orderType: z.literal("limit"),
    price: z.coerce.number().positive(),
    qty: z.coerce.number().positive(),
    equity: z.coerce.number().positive().optional(),
    type: z.enum(["LONG", "SHORT"]),
    market: z.string().trim().min(1),
  }),
  z.object({
    orderType: z.literal("market"),
    price: z.null().optional(),
    qty: z.coerce.number().positive(),
    equity: z.coerce.number().positive().optional(),
    type: z.enum(["LONG", "SHORT"]),
    market: z.string().trim().min(1),
  }),
]);

export type TCreateOrderSchema = z.infer<typeof CreateOrderSchema>;

export const RawMessageSchema = z.object({
  correlationId: z.string(),
  type: z.enum(["init_balance", "create_order"]),
  payload: z.string(),
});

const EngineSupportedTypes = z.enum(["init_balance", "create_order"]);
export const MessageSchema = z.object({
  correlationId: z.string(),
  type: EngineSupportedTypes,
  payload: z.record(z.string(), z.unknown()),
});
export type TMessageSchema = z.infer<typeof MessageSchema>;
export type TStreamMessage = {
  id: string;
  message: TMessageSchema;
};
export type TStreamResponse = {
  name: string;
  messages: TStreamMessage[];
}[];

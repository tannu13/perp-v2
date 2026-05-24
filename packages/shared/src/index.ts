import z from "zod";

export const CreateOrderSchema = z.discriminatedUnion("orderType", [
  z.object({
    orderType: z.literal("limit"),
    price: z.coerce.number().positive(),
    slippage: z.literal(0),
    qty: z.coerce.number().positive(),
    equity: z.coerce.number().positive().optional(),
    type: z.enum(["LONG", "SHORT"]),
    market: z.string().trim().min(1),
  }),
  z.object({
    orderType: z.literal("market"),
    price: z.literal(0),
    slippage: z.coerce.number().positive(),
    qty: z.coerce.number().positive(),
    equity: z.coerce.number().positive().optional(),
    type: z.enum(["LONG", "SHORT"]),
    market: z.string().trim().min(1),
  }),
]);

export type TCreateOrderSchema = z.infer<typeof CreateOrderSchema>;

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

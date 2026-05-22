import z from "zod";

export const OnRampSchema = z.object({
  amount: z.coerce.number().positive(),
});
export type TOnRampSchema = z.infer<typeof OnRampSchema>;

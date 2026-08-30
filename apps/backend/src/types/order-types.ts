import z from "zod";

export const OnRampSchema = z.object({
  amount: z.coerce.number().positive(),
});
export type TOnRampSchema = z.infer<typeof OnRampSchema>;

/**
 * `GET /fills` query (G11).
 *
 * Every field is optional — the route was previously unfiltered and unbounded,
 * and an existing caller must keep working. `limit` is coerced because query
 * strings are strings, and capped here as well as in the service so a bad value
 * is a 400 with the field named rather than a silent clamp.
 */
export const FillsQuerySchema = z.object({
  marketId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  before: z.string().trim().min(1).optional(),
});
export type TFillsQuerySchema = z.infer<typeof FillsQuerySchema>;

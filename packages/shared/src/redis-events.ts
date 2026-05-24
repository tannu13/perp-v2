import z from "zod";

const EngineSupportedTypes = z.enum([
  "init_balance",
  "onramp",
  "create_order",
  "cancel_order",
]);
export type TEngineSupportedTypes = z.infer<typeof EngineSupportedTypes>;

// engine requests
export const RawEngineRequestSchema = z.object({
  correlationId: z.string(),
  type: EngineSupportedTypes,
  payload: z.string(),
});

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
export const EngineResponseSchema = z.object({
  correlationId: z.string(),
  ok: z.boolean(),
  data: z.union([z.record(z.string(), z.unknown()), z.string()]),
  error: z.string(),
});
export type TEngineResponseSchema = z.infer<typeof EngineResponseSchema>;
export type TStreamEngineResponseMessage = {
  id: string;
  message: TEngineResponseSchema;
};
export type TStreamEngineResponse = {
  name: string;
  messages: TStreamEngineResponseMessage[];
}[];

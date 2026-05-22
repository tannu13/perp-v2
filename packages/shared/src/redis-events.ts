import z from "zod";

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

import z from "zod";

export const RawMessageSchema = z.object({
  correlationId: z.string(),
  payload: z.string(),
});

export const MessageSchema = z.object({
  correlationId: z.string(),
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

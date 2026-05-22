import z from "zod";

export const CreateUserSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().trim().min(1),
  name: z.string().trim().min(1),
});
export type TCreateUserSchema = z.infer<typeof CreateUserSchema>;

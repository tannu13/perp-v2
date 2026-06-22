import z from "zod";

const EnvSchema = z.object({
  WS_SERVER_PORT: z.coerce.number().positive().default(3010),
  REDIS_URL: z.string().min(1).startsWith("redis://"),
  ENGINE_RESPONSE_STREAM: z
    .string()
    .min(1)
    .default("engine-to-backend-trade-comms"),
  LISTENER_GROUP: z.string().min(1).default("ws-server-group"),
  LISTENER_GROUP_CONSUMER: z.string().min(1).default("ws-server"),
});

type Env = z.infer<typeof EnvSchema>;
let env: Env;
try {
  env = EnvSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("Invalid environment variables", error);
    console.error(JSON.stringify(z.treeifyError(error), null, 2));

    error.issues.forEach((issue) => {
      const path = issue.path.join(".");
      console.error(`  ${path}: ${issue.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export default env;
export { env };

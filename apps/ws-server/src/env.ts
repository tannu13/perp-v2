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
  /**
   * The same secret the backend signs with (§6.14).
   *
   * ws-server verifies WebSocket tickets with it and mints nothing, so this
   * process only ever needs the verify half — but the algorithm is HS256, so
   * the verify half IS the sign half. Worth knowing before this service is
   * deployed anywhere the backend is not.
   *
   * Required, with no default: a ws-server that booted without it would have
   * to either reject every private subscription or accept every one, and both
   * are worse than refusing to start.
   */
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
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

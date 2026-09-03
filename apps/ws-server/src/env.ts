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
  /**
   * The publish cadence for market state, in milliseconds.
   *
   * The engine broadcasts a full 20-level book on every order event, so a
   * market maker re-quoting five rungs a side emits ~20 depth frames inside a
   * few hundred milliseconds and then nothing until it re-quotes again. That
   * burst carries no more information than its last frame — depth is a
   * snapshot, not a delta — but it costs every subscriber a render per frame,
   * which is what made the ladder arrive in one lurch and then sit still.
   *
   * So market state is published on a fixed cadence instead of per event, the
   * way a real venue's depth stream is (Binance: 100ms / 1000ms). Zero disables
   * the coalescing and restores one publish per engine reply.
   */
  MARKET_STATE_INTERVAL_MS: z.coerce.number().int().nonnegative().default(100),
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

import z from "zod";

const EnvSchema = z.object({
  WS_SERVER_PORT: z.coerce.number().positive().default(3010),
  /**
   * Which half of the consumer-group behaviour below applies.
   *
   * `dev` keeps LISTENER_GROUP exactly as given, so a `bun --watch` restart
   * rejoins the group it left. `prod` suffixes it per process, which is what
   * lets this service run more than one replica — see setup-comms.ts.
   *
   * Defaulting to `dev` means a deployment that forgets to set this runs with
   * the shared group, which is correct for one replica and silently halves the
   * feed for two. `k8s/08-ws-server.yaml` sets it.
   */
  APP_STAGE: z.enum(["dev", "prod"]).default("dev"),
  REDIS_URL: z.string().min(1).startsWith("redis://"),
  ENGINE_RESPONSE_STREAM: z
    .string()
    .min(1)
    .default("engine-to-backend-trade-comms"),
  /**
   * The consumer group's base name. In `prod` it is a prefix, not the whole
   * name — a per-process suffix is appended.
   */
  LISTENER_GROUP: z.string().min(1).default("ws-server-group"),
  LISTENER_GROUP_CONSUMER: z.string().min(1).default("ws-server"),
  /**
   * The same secret the backend signs with.
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

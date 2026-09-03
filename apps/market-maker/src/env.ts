import z from "zod";

/**
 * A boolean out of an environment variable.
 *
 * Everything in `process.env` is a string, and `Boolean("false")` is `true` —
 * the classic way to ship a kill switch that cannot be switched off. Only the
 * three obvious falsey spellings turn the flag off; anything else is on.
 */
const envFlag = (fallback: boolean) =>
  z
    .string()
    .default(String(fallback))
    .transform((value) => !["false", "0", "no"].includes(value.trim().toLowerCase()));

/** Comma-separated list, empty string meaning "no filter". */
const envList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  /**
   * The kill switch.
   *
   * This service is started by `bun run dev` alongside everything else, so the
   * only way to demo a cold, empty book — which is a real UI state with real
   * empty-state components behind it — is to be able to turn the bot off
   * without editing turbo's task graph.
   */
  MM_ENABLED: envFlag(true),

  API_URL: z.string().min(1).default("http://localhost:3000"),
  WS_URL: z.string().startsWith("ws").default("ws://localhost:3010"),

  MM_USERNAME: z.string().trim().min(1).default("market-maker-bot"),
  MM_PASSWORD: z.string().min(8),
  MM_NAME: z.string().trim().min(1).default("Market Maker"),

  TAKER_ENABLED: envFlag(true),
  TAKER_USERNAME: z.string().trim().min(1).default("flow-bot"),
  TAKER_PASSWORD: z.string().min(8),
  TAKER_NAME: z.string().trim().min(1).default("Flow Bot"),

  /** Empty = every market `GET /markets` returns. Otherwise a list of slugs. */
  MM_MARKETS: envList,

  /** 20 is also the engine's cap — `getMarketDepth` walks at most that many. */
  MM_LEVELS: z.coerce.number().int().positive().max(20).default(20),
  /** Full width of the quoted spread. Half of it sits on each side of the anchor. */
  MM_SPREAD_BPS: z.coerce.number().positive().default(2),
  /**
   * The gap between rungs, and therefore the size of the absolute price grid
   * the ladder is snapped to. Rounded to a whole number of ticks, never below
   * one — see `gridSize`, which is also where the churn argument lives.
   */
  MM_LEVEL_STEP_BPS: z.coerce.number().positive().default(0.5),
  MM_SKEW_BPS: z.coerce.number().nonnegative().default(3),
  MM_BASE_NOTIONAL: z.coerce.number().positive().default(900),
  /** Nonzero costs a periodic requote as the ladder scrolls — see `buildLadder`. */
  MM_SIZE_GROWTH: z.coerce.number().nonnegative().default(0),
  /** Fixed per-rung raggedness, so the size column is not a visible ramp. */
  MM_SIZE_JITTER: z.coerce.number().min(0).max(0.9).default(0.5),
  MM_LEVERAGE: z.coerce.number().positive().default(2),
  MM_REQUOTE_BPS: z.coerce.number().nonnegative().default(3),
  MM_REFRESH_MS: z.coerce.number().int().positive().default(600),
  MM_STALE_MS: z.coerce.number().int().positive().default(10000),
  MM_MAX_INVENTORY_NOTIONAL: z.coerce.number().positive().default(20000),
  MM_BALANCE_FLOOR: z.coerce.number().positive().default(60000),
  MM_TOPUP: z.coerce.number().positive().default(250000),

  TAKER_MIN_MS: z.coerce.number().int().positive().default(4000),
  TAKER_MAX_MS: z.coerce.number().int().positive().default(15000),
  TAKER_NOTIONAL: z.coerce.number().positive().default(500),
  TAKER_SLIPPAGE_PCT: z.coerce.number().positive().default(1),
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

if (env.TAKER_MAX_MS < env.TAKER_MIN_MS) {
  console.error("TAKER_MAX_MS must be >= TAKER_MIN_MS");
  process.exit(1);
}

export default env;
export { env };

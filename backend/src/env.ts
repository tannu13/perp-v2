import z from "zod";

const EnvSchema = z.object({
  APP_PORT: z.coerce.number().positive().default(3000),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  APP_STAGE: z.enum(["dev", "prod"]).default("dev"),
  SALT_ROUNDS: z.coerce.number().positive().default(10),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  REDIS_URL: z.string().startsWith("redis://"),
  INCOMING_STREAM: z.string().min(1).default("engine-to-backend-trade-comms"),
  OUTGOING_STREAM: z.string().min(1).default("backend-to-engine-trade-comms"),
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

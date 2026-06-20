import z from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  APP_STAGE: z.enum(["dev", "prod"]).default("dev"),
  REDIS_URL: z.string().min(1).startsWith("redis://"),
  INCOMING_STREAM: z.string().min(1).default("backend-to-engine-trade-comms"),
  OUTGOING_STREAM: z.string().min(1).default("engine-to-backend-trade-comms"),
  LISTENER_GROUP: z.string().min(1).default("engine-group"),
  LISTENER_GROUP_CONSUMER: z.string().min(1).default("engine"),
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_BUCKET_NAME: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
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

export const isDev = () => env.APP_STAGE === "dev";

export default env;
export { env };

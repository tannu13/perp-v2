import z from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql://"),
  REDIS_URL: z.string().min(1).startsWith("redis://"),
  REQUEST_STREAM: z.string().min(1).default("backend-to-engine-trade-comms"),
  RESPONSE_STREAM: z.string().min(1).default("engine-to-backend-trade-comms"),
  LISTENER_GROUP: z.string().min(1).default("engine-group"),
  LISTENER_GROUP_CONSUMER: z.string().min(1).default("engine"),
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

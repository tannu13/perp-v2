import z from "zod";

// Kubernetes and ECS both hand a container an env var set to "" when the
// underlying secret key is absent, so an empty string has to mean "not set"
// rather than "set to nothing" — otherwise .min(1) rejects the very case these
// fields exist to allow.
const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  APP_STAGE: z.enum(["dev", "prod"]).default("dev"),
  REDIS_URL: z.string().min(1).startsWith("redis://"),
  INCOMING_STREAM: z.string().min(1).default("backend-to-engine-trade-comms"),
  OUTGOING_STREAM: z.string().min(1).default("engine-to-backend-trade-comms"),
  LISTENER_GROUP: z.string().min(1).default("engine-group"),
  LISTENER_GROUP_CONSUMER: z.string().min(1).default("engine"),
  AWS_REGION: z.string().min(1),
  // Optional on purpose. In AWS the engine gets its credentials from the
  // instance/task role via the SDK's default chain, and there is no key pair to
  // supply; requiring these forces a long-lived key into the deploy manifest,
  // which is exactly what the role exists to avoid. Set them locally, where
  // MinIO has no other way to authenticate.
  AWS_ACCESS_KEY_ID: optionalSecret,
  AWS_SECRET_ACCESS_KEY: optionalSecret,
  AWS_BUCKET_NAME: z.string().min(1),
  // Presence of this is what switches the S3 client to MinIO. Production never
  // sets it and must not: pointing a real deploy at a local endpoint fails in a
  // way that looks like a permissions problem.
  MINIO_ENDPOINT: optionalSecret,
});

// Optional above means "AWS supplies these another way", not "the engine can
// run without object storage". Locally there is no other way, so a missing
// MinIO endpoint or key pair has to fail here rather than silently send
// snapshots to real S3 — or to nowhere.
const Env = EnvSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== "development") return;

  for (const key of [
    "MINIO_ENDPOINT",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ] as const) {
    if (!value[key]) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is required when NODE_ENV=development (local MinIO has no instance role to fall back on)`,
      });
    }
  }
});

type Env = z.infer<typeof EnvSchema>;
let env: Env;
try {
  env = Env.parse(process.env);
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

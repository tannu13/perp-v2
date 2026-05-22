import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { createControllers } from "./controllers";
import { createRoutes } from "./routes";
import { createServices } from "./services";
import { AppError } from "./errors/app-error";
import { setupComms } from "./services/backend-comms";
import db from "@repo/db";
import { users } from "@repo/db/schema";

const app = express();

const comms = await setupComms();
await comms.handlePendingEntries();
comms.listenToIncomingEvents();

app.use(helmet());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", async (req: Request, res: Response) => {
  const services = {
    db: "unhealthy",
  };

  try {
    await db.select().from(users).limit(1);
    services.db = "healthy";
  } catch (err) {
    console.error(
      "DB Health Check Failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const isHealthy = services.db === "healthy";
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "OK" : "ERROR",
    db: services.db,
    redis: "pending",
  });
});

const services = createServices({ sendToEngine: comms.sendToEngineStream });
const controllers = createControllers(services);
const router = createRoutes(controllers);

app.use(router.authRouter);
app.use(router.orderRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({
      code: err.errorCode,
      message: err.message,
    });
  }
  console.error(err);
  return res.status(500).json({
    code: "INTERNAL_SERVER_ERROR",
    message:
      err instanceof Error ? err.message : "Something went wrong on our end.",
  });
});

export default app;
export { app };

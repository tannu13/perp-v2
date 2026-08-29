import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createControllers } from "./controllers";
import { createRoutes } from "./routes";
import { createServices } from "./services";
import { AppError } from "./errors/app-error";
import type { TComms } from "./services/backend-comms";
import { verifyOrigin } from "./middlewares/verify-origin";
import env from "./env";
import db from "@repo/db";
import { users } from "@repo/db/schema";

/**
 * Builds the Express app around an engine transport.
 *
 * This used to run `await setupComms()` at module scope, which meant importing
 * the app opened two Redis connections and started an infinite `xReadGroup`
 * loop — so the app could not be exercised by a test, and every test of a route
 * would have been a test of Redis. The transport is now injected, matching how
 * `createServices` / `createControllers` / `createRoutes` already take their
 * dependencies. The real wiring lives in `index.ts`.
 */
export const createApp = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  /**
   * Reads the session cookie the browser sends. Must run before anything that
   * calls `readToken`, which is every authenticated route.
   */
  app.use(cookieParser());

  /**
   * CSRF, layer two. Before the body parsers so a forged POST is rejected
   * without its payload being read. See `verify-origin.ts`.
   */
  app.use(verifyOrigin);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", async (_req: Request, res: Response) => {
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

  const services = createServices({ sendToEngine });
  const controllers = createControllers(services);
  const router = createRoutes(controllers);

  app.use(router.marketRouter);
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

  return app;
};

export type TApp = ReturnType<typeof createApp>;

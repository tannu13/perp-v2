import express, { type Request, type Response } from "express";
import { pool } from "./db/connection";
import helmet from "helmet";

const app = express();

app.use(helmet());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", async (req: Request, res: Response) => {
  const services = {
    db: "unhealthy",
  };

  try {
    await pool.query("Select 1");
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

export default app;
export { app };

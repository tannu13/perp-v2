import { describe, expect, it } from "bun:test";
import { AppError } from "../errors/app-error";

/**
 * The engine-timeout path (G4), exercised for real.
 *
 * Needs Redis but deliberately NOT the engine: the whole point is what happens
 * when a request is published and nothing ever answers it. Before the fix, this
 * test could not have been written — the promise had no reject path and no
 * deadline, so it would simply have hung until the runner gave up.
 *
 * The request published is `get_depth` for a market id that does not exist, so
 * that if an engine is running after all it replies with an error and mutates
 * no state.
 */
const hasRedis = Boolean(process.env.REDIS_URL);
const describeRedis = hasRedis ? describe : describe.skip;

/** Slightly longer than the default ENGINE_TIMEOUT_MS of 5000. */
const TEST_TIMEOUT_MS = 15_000;

describeRedis("sendToEngineStream", () => {
  it(
    "rejects with 503 ENGINE_TIMEOUT instead of hanging forever",
    async () => {
      const { setupComms } = await import("./backend-comms");
      const comms = await setupComms();

      expect(comms.pendingRequestCount()).toBe(0);

      const pending = comms.sendToEngineStream("get_depth", {
        marketId: "00000000-0000-0000-0000-000000000000",
      });

      let caught: unknown;
      try {
        await pending;
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).statusCode).toBe(503);
      expect((caught as AppError).errorCode).toBe("ENGINE_TIMEOUT");

      // The resolver map used to grow by one entry per request and never
      // shrink, on the success path as well as this one.
      expect(comms.pendingRequestCount()).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});

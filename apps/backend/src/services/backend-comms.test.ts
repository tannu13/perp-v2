import { describe, expect, it } from "bun:test";
import { asTransportFailure } from "./transport-failure";
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

/**
 * D19: with Redis stopped, `xAdd` rejects and the request has to be answered.
 * What it is answered *with* decides what the browser says happened to the
 * order — and the one thing it must not say is that the order was rejected.
 */
describe("a write that never reached the stream", () => {
  it("becomes a 503 ENGINE_TIMEOUT, so the ticket says Not confirmed", () => {
    class SocketClosedUnexpectedlyError extends Error {}

    const mapped = asTransportFailure(
      new SocketClosedUnexpectedlyError("Socket closed unexpectedly"),
    );

    expect(mapped).toBeInstanceOf(AppError);
    const err = mapped as AppError;
    expect(err.statusCode).toBe(503);
    expect(err.errorCode).toBe("ENGINE_TIMEOUT");
    // `isOutcomeUnknown` on the client keys off the code, not the words.
    expect(err.message).toBe("Could not reach the matching engine");
  });

  it("maps a refused connection too", () => {
    const mapped = asTransportFailure(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), {
        code: "ECONNREFUSED",
      }),
    );

    expect((mapped as AppError).errorCode).toBe("ENGINE_TIMEOUT");
  });

  it("leaves a real bug alone, so it still surfaces as a 500", () => {
    const bug = new TypeError("payload.map is not a function");
    expect(asTransportFailure(bug)).toBe(bug);
  });
});

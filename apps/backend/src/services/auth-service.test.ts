import { describe, expect, it } from "bun:test";
import { createAuthService } from "./auth-service";
import { ServiceUnavailableError } from "../errors/custom-errors";

/**
 * Regression cover for a crash found by driving the real UI.
 *
 * `signup` fires `init_balance` at the engine without awaiting it. Before the
 * engine transport had a timeout that promise could never reject, so nothing
 * handled it. Once Phase 1 gave it a reject path, a slow engine produced an
 * unhandled rejection — and an unhandled rejection ends the Bun process. A
 * signup minutes earlier could therefore take the entire API down.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb("signup does not let a fire-and-forget engine call crash us", () => {
  it("survives init_balance rejecting", async () => {
    let rejected = false;

    const sendToEngine = ((type: string) => {
      if (type === "init_balance") {
        rejected = true;
        return Promise.reject(
          new ServiceUnavailableError(
            "The matching engine is not responding",
            "ENGINE_TIMEOUT",
          ),
        );
      }
      return Promise.resolve({ ok: true, data: { backend: {} } });
    }) as never;

    const service = createAuthService({ sendToEngine });

    const result = await service.signup(
      `crash-probe-${Date.now()}`,
      "pw123456",
      "Crash Probe",
    );

    expect(rejected).toBe(true);
    // Signup still succeeds: the engine creates the user lazily on first read,
    // so a dropped init_balance costs a zero balance, not an account.
    expect(result.userId).toBeTruthy();
    expect(result.token).toBeTruthy();

    // Give the rejected promise a turn to become "unhandled" if it is going to.
    // Without the `.catch()` in auth-service this is where the process dies.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

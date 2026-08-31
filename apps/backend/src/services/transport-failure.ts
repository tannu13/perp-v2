import { isRedisConnectionError } from "@repo/shared/redis-resilience";
import { ServiceUnavailableError } from "../errors/custom-errors";

/**
 * Redis being unreachable is a 503, not a 500 (D19).
 *
 * The distinction is the whole of §7.4 on a write path. A 500 is rendered as
 * "something went wrong"; `ENGINE_TIMEOUT` sets `isOutcomeUnknown` on the
 * client and the ticket says **Not confirmed** — which is the true statement,
 * because the request never left the building and nothing downstream can be
 * asked what became of it. Anything that is not a transport failure is passed
 * through untouched, so a real bug still surfaces as a real bug.
 *
 * It lives in its own module rather than in `backend-comms.ts` so a test can
 * import it: `backend-comms.ts` reads `env` at module scope, which is why its
 * own spec imports it dynamically behind a `describe.skip`.
 */
export const asTransportFailure = (err: unknown): unknown =>
  isRedisConnectionError(err)
    ? new ServiceUnavailableError(
        "Could not reach the matching engine",
        "ENGINE_TIMEOUT",
      )
    : err;

import { describe, expect, it } from "bun:test";
import { ValidFeeds } from "./createWSServer";

/**
 * The feed names are a wire contract: the browser puts them in the `feeds`
 * query parameter at upgrade and the server turns each into a
 * `feed:{marketId}:{feed}` subscription. Phase 11 subscribes to all four.
 */
describe("ValidFeeds", () => {
  it("is exactly the four feeds the client may subscribe to", () => {
    expect([...ValidFeeds].sort()).toEqual([
      "depth",
      "last-traded-price",
      "mark-price",
      "trades",
    ]);
  });

  it("lists `trades`, which now has a publisher", () => {
    // Phase 11 subscribed to a feed nothing wrote to. Phase 12's publisher is
    // in `createHandler`, and what it puts on the topic is asserted there.
    expect(ValidFeeds).toContain("trades");
  });
});

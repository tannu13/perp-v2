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

  it("still lists `trades`, which nothing publishes to yet", () => {
    // Deliberate: subscribing succeeds and no message ever arrives. The
    // publisher lands in Phase 12; until then this is a documented dead feed.
    expect(ValidFeeds).toContain("trades");
  });
});

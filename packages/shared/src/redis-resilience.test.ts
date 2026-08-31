import { describe, expect, it } from "bun:test";
import {
  attachRedisLogging,
  isRedisConnectionError,
  reconnectDelayMs,
  redisClientOptions,
  runStreamLoop,
} from "./redis-resilience";

/**
 * These stand in for node-redis's own error classes. They are declared rather
 * than imported on purpose: `@repo/shared` has no `redis` dependency, and the
 * fleet runs two major versions of it. What the detector actually reads is
 * `constructor.name` — so a class with the same name is the same input, which
 * is the point being tested. The names were checked against the `errors.d.ts`
 * of both `@redis/client@5.12.1` and `@6.0.0`; they are identical.
 */
class SocketClosedUnexpectedlyError extends Error {}
class ClientOfflineError extends Error {}
class ReconnectStrategyError extends Error {}
class ErrorReply extends Error {}

describe("isRedisConnectionError", () => {
  it("recognises the error that killed all four services", () => {
    // The exact shape: no `name`, no `code`, only a class and a message.
    const err = new SocketClosedUnexpectedlyError("Socket closed unexpectedly");
    expect(err.name).toBe("Error"); // node-redis sets neither
    expect(isRedisConnectionError(err)).toBe(true);
  });

  it("recognises the rest of the transport family", () => {
    expect(isRedisConnectionError(new ClientOfflineError())).toBe(true);
    expect(isRedisConnectionError(new ReconnectStrategyError())).toBe(true);
  });

  it("recognises a raw socket failure by its code", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), {
      code: "ECONNREFUSED",
    });
    expect(isRedisConnectionError(err)).toBe(true);
  });

  it("does NOT swallow an answer from a live Redis", () => {
    // ErrorReply means the server replied and said no — a bug of ours, not an
    // outage. Retrying it forever would be an infinite loop over a bad command.
    expect(isRedisConnectionError(new ErrorReply("NOGROUP no such key"))).toBe(
      false,
    );
  });

  it("does NOT swallow an ordinary failure", () => {
    expect(isRedisConnectionError(new Error("boom"))).toBe(false);
    expect(isRedisConnectionError(new TypeError("x is not a function"))).toBe(
      false,
    );
    expect(isRedisConnectionError(null)).toBe(false);
    expect(isRedisConnectionError("ECONNREFUSED")).toBe(false);
  });

  it("does not treat a Postgres error code as a Redis outage", () => {
    // db-writer's duplicate-key path: `23505` must keep reaching its handler.
    const err = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(isRedisConnectionError(err)).toBe(false);
  });
});

describe("reconnectDelayMs", () => {
  it("backs off and then holds at three seconds", () => {
    expect(reconnectDelayMs(0)).toBe(100);
    expect(reconnectDelayMs(1)).toBe(200);
    expect(reconnectDelayMs(4)).toBe(1_600);
    expect(reconnectDelayMs(5)).toBe(3_000);
    expect(reconnectDelayMs(50)).toBe(3_000);
  });

  it("never gives up — a strategy that returns an Error stops reconnecting", () => {
    expect(typeof reconnectDelayMs(1_000)).toBe("number");
  });
});

describe("redisClientOptions", () => {
  it("carries the URL and the shared reconnect strategy", () => {
    const options = redisClientOptions("redis://localhost:6379");
    expect(options.url).toBe("redis://localhost:6379");
    expect(options.socket.reconnectStrategy).toBe(reconnectDelayMs);
  });
});

describe("attachRedisLogging", () => {
  /** Just enough of an emitter to drive the two events it listens for. */
  const fakeClient = () => {
    const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
    return {
      on(event: string, listener: (arg?: unknown) => void) {
        (listeners[event] ??= []).push(listener);
        return this;
      },
      emit(event: string, arg?: unknown) {
        listeners[event]?.forEach((l) => l(arg));
      },
    };
  };

  const captureConsole = async (run: () => void | Promise<void>) => {
    const lines: string[] = [];
    const error = console.error;
    const log = console.log;
    console.error = (...args) => lines.push(args.join(" "));
    console.log = (...args) => lines.push(args.join(" "));
    try {
      await run();
    } finally {
      console.error = error;
      console.log = log;
    }
    return lines;
  };

  it("logs the first failure of an outage and then stays quiet", async () => {
    const client = fakeClient();

    const lines = await captureConsole(() => {
      attachRedisLogging(client, "test");
      // Measured for real: node-redis emits one of these per reconnect
      // attempt, which was 56 KB of stack traces in ten seconds.
      for (let i = 0; i < 200; i++) {
        client.emit("error", new Error("Socket closed unexpectedly"));
      }
    });

    expect(lines).toEqual(["[test] redis error: Socket closed unexpectedly"]);
  });

  it("says how many attempts it took to come back", async () => {
    const client = fakeClient();

    const lines = await captureConsole(() => {
      attachRedisLogging(client, "test");
      client.emit("error", new Error("boom"));
      client.emit("error", new Error("boom"));
      client.emit("ready");
    });

    expect(lines[1]).toBe(
      "[test] redis connection restored after 2 failed attempt(s)",
    );
  });

  it("logs the next outage too — the counter resets on ready", async () => {
    const client = fakeClient();

    const lines = await captureConsole(() => {
      attachRedisLogging(client, "test");
      client.emit("error", new Error("first"));
      client.emit("ready");
      client.emit("error", new Error("second"));
    });

    expect(lines).toContain("[test] redis error: second");
  });

  it("says nothing on a clean first connect", async () => {
    const client = fakeClient();

    const lines = await captureConsole(() => {
      attachRedisLogging(client, "test");
      client.emit("ready");
    });

    expect(lines).toEqual([]);
  });
});

describe("runStreamLoop", () => {
  it("keeps reading after a dropped connection", async () => {
    const calls: string[] = [];
    let step = 0;

    const loop = runStreamLoop("test", async () => {
      step += 1;
      calls.push(`step ${step}`);
      if (step === 1) throw new SocketClosedUnexpectedlyError();
      if (step >= 3) throw new Error("stop"); // ends the test
    });

    await expect(loop).rejects.toThrow("stop");
    // Step 1 dropped; the loop paused and came back rather than ending.
    expect(calls).toEqual(["step 1", "step 2", "step 3"]);
  });

  it("propagates anything that is not a connection failure", async () => {
    // db-writer relies on this: a failed database write must still kill the
    // process, so the unacknowledged entry is redelivered on restart.
    let calls = 0;
    const loop = runStreamLoop("test", async () => {
      calls += 1;
      throw Object.assign(new Error("insert failed"), { code: "23505" });
    });

    await expect(loop).rejects.toThrow("insert failed");
    expect(calls).toBe(1);
  });
});

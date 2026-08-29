import { describe, expect, it } from "bun:test";
import { AppError } from "./app-error";
import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  UnauthorizedError,
} from "./custom-errors";

/**
 * The status/code pairs the frontend's error normaliser will map in Phase 3,
 * and that Phase 1 extends with TOKEN_* and ENGINE_TIMEOUT. Pinning them here
 * makes a change to the wire contract a visible one.
 */
describe("error taxonomy", () => {
  it("maps each error to its status and code", () => {
    expect([
      new NotFoundError().statusCode,
      new NotFoundError().errorCode,
    ]).toEqual([404, "RESOURCE_NOT_FOUND"]);
    expect([
      new ConflictError().statusCode,
      new ConflictError().errorCode,
    ]).toEqual([409, "RESOURCE_ALREADY_EXISTS"]);
    expect([
      new InvalidRequestError().statusCode,
      new InvalidRequestError().errorCode,
    ]).toEqual([400, "INVALID_REQUEST"]);
    expect([
      new UnauthorizedError().statusCode,
      new UnauthorizedError().errorCode,
    ]).toEqual([401, "UNAUTHORIZED_ERROR"]);
  });

  it("marks every one operational, which is what the terminal handler keys on", () => {
    // server.ts returns { code, message } only for operational AppErrors and a
    // bare 500 otherwise — this is why an expired JWT currently 500s (Phase 1).
    for (const err of [
      new NotFoundError(),
      new ConflictError(),
      new InvalidRequestError(),
      new UnauthorizedError(),
    ]) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.isOperational).toBe(true);
    }
  });

  it("carries a caller-supplied message through", () => {
    expect(new InvalidRequestError("Market does not exist").message).toBe(
      "Market does not exist",
    );
  });
});

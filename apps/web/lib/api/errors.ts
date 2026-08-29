/**
 * One error type for everything the API can do to us.
 *
 * The backend speaks three different failure shapes, and a component should not
 * have to know which one it is looking at:
 *
 *   { code, message }                     an AppError — 400/401/404/409/503
 *   { error, details: [{field, message}] } a zod rejection from validate.ts
 *   (no JSON at all)                      a proxy, a crash, a dead network
 *
 * They collapse into `ApiError` here, once, so every call site can branch on
 * `code` alone. See §3.4 and §7.4 of UI_BACKEND_INTEGRATION_PLAN.md.
 */

/** Codes we produce locally; the rest come from the server verbatim. */
export const CLIENT_ERROR_CODES = {
  /** Request never completed: offline, DNS, CORS, connection refused. */
  NETWORK: "NETWORK",
  /** Request exceeded the client deadline and was aborted. */
  TIMEOUT: "TIMEOUT",
  /** A 2xx whose body did not match the schema we expect — always a bug. */
  SCHEMA: "SCHEMA",
  /** A non-2xx whose body we could not parse at all. */
  UNKNOWN: "UNKNOWN",
} as const;

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got one. */
  readonly status: number;
  /** Machine-readable discriminator. Never rendered to a user. */
  readonly code: string;
  /** Per-field messages from a zod rejection, keyed by field path. */
  readonly fieldErrors?: FieldErrors;
  /** The route that failed, for logs — not for display. */
  readonly route?: string;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    fieldErrors?: FieldErrors;
    route?: string;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors;
    this.route = init.route;
  }

  /** The session is gone — the 401 interceptor in Phase 4 keys on this. */
  get isAuthFailure() {
    return (
      this.status === 401 ||
      this.code === "TOKEN_EXPIRED" ||
      this.code === "TOKEN_INVALID" ||
      this.code === "TOKEN_MISSING"
    );
  }

  /** Worth offering a retry for: nothing about the request itself was wrong. */
  get isRetryable() {
    return (
      this.code === CLIENT_ERROR_CODES.NETWORK ||
      this.code === CLIENT_ERROR_CODES.TIMEOUT ||
      this.code === "ENGINE_TIMEOUT" ||
      this.status >= 500
    );
  }
}

type ZodDetail = { field?: unknown; message?: unknown };

/**
 * Turns a parsed error body into an `ApiError`.
 *
 * Kept separate from the transport so it can be tested against literal server
 * payloads rather than against a mocked `fetch`.
 */
export function toApiError(
  status: number,
  body: unknown,
  route?: string,
): ApiError {
  const shape = body as Record<string, unknown> | null | undefined;

  // Shape 2: zod rejection from validate.ts.
  if (
    shape &&
    typeof shape.error === "string" &&
    Array.isArray(shape.details)
  ) {
    const fieldErrors: FieldErrors = {};
    for (const detail of shape.details as ZodDetail[]) {
      if (
        typeof detail?.field === "string" &&
        typeof detail?.message === "string"
      ) {
        // First message per field wins: a field with three problems should not
        // render three lines under one input.
        fieldErrors[detail.field] ??= detail.message;
      }
    }
    return new ApiError({
      status,
      code: "VALIDATION_FAILED",
      message: shape.error,
      fieldErrors,
      route,
    });
  }

  // Shape 1: an AppError from the terminal handler.
  if (shape && typeof shape.code === "string") {
    return new ApiError({
      status,
      code: shape.code,
      message:
        typeof shape.message === "string" ? shape.message : "Request failed",
      route,
    });
  }

  // The pre-Phase-1 missing-token shape, and anything else with only a message.
  if (shape && typeof shape.message === "string") {
    return new ApiError({
      status,
      code: status === 401 ? "TOKEN_MISSING" : CLIENT_ERROR_CODES.UNKNOWN,
      message: shape.message,
      route,
    });
  }

  // Shape 3: no usable body.
  return new ApiError({
    status,
    code: CLIENT_ERROR_CODES.UNKNOWN,
    message: `Request failed with status ${status}`,
    route,
  });
}

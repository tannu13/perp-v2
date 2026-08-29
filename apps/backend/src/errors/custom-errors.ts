import { AppError } from "./app-error";

export class NotFoundError extends AppError {
  constructor(
    message = "Resource not found",
    errorCode = "RESOURCE_NOT_FOUND",
  ) {
    super(message, 404, errorCode);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = "Resource already exists",
    errorCode = "RESOURCE_ALREADY_EXISTS",
  ) {
    super(message, 409, errorCode);
  }
}

export class InvalidRequestError extends AppError {
  constructor(message = "Invalid Request", errorCode = "INVALID_REQUEST") {
    super(message, 400, errorCode);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = "Unauthorized Error",
    errorCode = "UNAUTHORIZED_ERROR",
  ) {
    super(message, 401, errorCode);
  }
}

/**
 * The dependency is down, not the request. Distinct from a 500 so the frontend
 * can say "the matching engine is not responding" rather than "something went
 * wrong", and so a retry is obviously the right response.
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = "Service temporarily unavailable",
    errorCode = "SERVICE_UNAVAILABLE",
  ) {
    super(message, 503, errorCode);
  }
}

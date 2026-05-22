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

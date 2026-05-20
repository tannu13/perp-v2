export class AppError extends Error {
  statusCode: number;
  errorCode: string = "";
  isOperational: boolean = true;

  constructor(
    message: string,
    statusCode: number,
    errorCode = "INTERNAL_ERROR",
  ) {
    super(message);

    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

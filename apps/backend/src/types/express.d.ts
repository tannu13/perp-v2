declare global {
  namespace Express {
    interface Request {
      userId?: string;
      validated?: {
        query?: Record<string, unknown>;
      };
    }
  }
}

export {};

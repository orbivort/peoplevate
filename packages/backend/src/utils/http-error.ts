/**
 * Standard application error carrying an HTTP status code.
 *
 * Thrown by services and caught by the centralized error handler
 * (`src/middleware/error-handler.ts`), which maps it to a JSON response
 * with a consistent `{ error, code? }` shape.
 *
 * `status` is kept as an alias of `statusCode` for backward compatibility
 * with code/tests that historically read `.status` from the error.
 */
export class HttpError extends Error {
  public readonly status: number;

  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = statusCode;
  }
}

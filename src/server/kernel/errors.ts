/**
 * Business-level errors. Every error a caller is expected to see carries a
 * stable machine `code`, a human message safe to show, and an HTTP status.
 * Anything that is *not* an AppError is an unexpected fault: the HTTP layer
 * logs it and answers with a generic message — never a stack trace.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export const validation = (message: string, details?: unknown) =>
  new AppError("VALIDATION", message, 400, details);
export const notFound = (what: string) =>
  new AppError("NOT_FOUND", `${what} not found.`, 404);
export const conflict = (message: string, code = "CONFLICT") =>
  new AppError(code, message, 409);
export const unauthorized = (message = "Sign in to continue.") =>
  new AppError("UNAUTHENTICATED", message, 401);
export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError("FORBIDDEN", message, 403);
export function ensure(
  condition: unknown,
  message: string,
  code = "VALIDATION",
): asserts condition {
  if (!condition)
    throw new AppError(code, message, code === "CONFLICT" ? 409 : 400);
}

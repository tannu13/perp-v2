/**
 * The API layer's public surface.
 *
 * Safe as a barrel: these are plain functions, types and zod objects with no
 * React context anywhere. The rule in CLAUDE.md about importing providers by
 * path applies to modules that create context — this is not one.
 */
export * from "./endpoints";
export { ApiError, CLIENT_ERROR_CODES, toApiError } from "./errors";
export type { FieldErrors } from "./errors";
export { setAuthTokenGetter } from "./http";
export type { TokenGetter } from "./http";
export * from "./schemas";

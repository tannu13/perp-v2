/**
 * Teaches `bun:test`'s `expect` about the jest-dom matchers registered in
 * ./setup.ts. Without this the matchers work at runtime and fail type-check,
 * which is the worst of both.
 */
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T> extends TestingLibraryMatchers<
    typeof expect.stringContaining,
    T
  > {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<
    unknown,
    unknown
  > {}
}

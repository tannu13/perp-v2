/**
 * Matchers and per-test cleanup. Runs after ./test/happydom.ts, which must have
 * already put a DOM on globalThis — see the comment there.
 */
import { afterEach, expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";

expect.extend(matchers as never);

// React Testing Library does not auto-clean under bun:test.
afterEach(() => cleanup());

/**
 * Registers a DOM on globalThis.
 *
 * Kept in its own preload file that runs BEFORE ./test/setup.ts. ES imports are
 * evaluated before any statement in their module, so `@testing-library/dom`
 * binds its `screen` helpers to whatever `document` exists at import time — if
 * the registration and the import live in one file, `screen` captures "no
 * document" and every query throws.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) {
  GlobalRegistrator.register();
}

/**
 * Thin wrapper that invokes the coverage gate and converts thrown errors into
 * a clean message + non-zero exit, so `npm run coverage` always exits with a
 * sensible code regardless of whether the failure was a `process.exit` inside
 * {@link runGate} or a thrown `Error` from `collectSources`/`resolveEmitPaths`.
 *
 * Run via `node scripts/run-coverage-gate.ts` (the `npm run coverage` script).
 */

import { resolve } from "node:path";
import { runGate } from "./coverage-gate.ts";

try {
  runGate(resolve(import.meta.dirname, ".."));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
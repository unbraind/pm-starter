/**
 * Keep full local/release depth by default; quick runs the same deterministic
 * seed prefix at one tenth depth, with at least 25 cases (capped by full count).
 * Callers keep seed generation and per-case assertions identical in both modes.
 */
export function testDepth(full: number): number {
  return process.env.PM_TEST_DEPTH === "quick" ? Math.min(full, Math.max(25, Math.ceil(full / 10))) : full;
}

/** Scale harness watchdogs only; product deadline assertions remain unchanged. */
export function testTimeout(milliseconds: number, value = process.env.PM_TEST_TIME_SCALE ?? "1"): number {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isSafeInteger(Math.ceil(milliseconds * scale)) || Math.ceil(milliseconds * scale) > 2_147_483_647) {
    throw new Error("PM_TEST_TIME_SCALE must yield a positive safe timeout");
  }
  return Math.ceil(milliseconds * scale);
}

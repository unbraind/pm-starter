import assert from "node:assert/strict";
import test from "node:test";
import { testDepth, testTimeout } from "./support/depth.ts";

test("depth defaults to full and quick preserves a deterministic prefix with a floor", () => {
  const original = process.env.PM_TEST_DEPTH;
  try {
    delete process.env.PM_TEST_DEPTH;
    assert.equal(testDepth(500), 500);
    process.env.PM_TEST_DEPTH = "quick";
    assert.equal(testDepth(500), 50);
    assert.equal(testDepth(50), 25);
    assert.equal(testDepth(16), 16);
  } finally {
    if (original === undefined) delete process.env.PM_TEST_DEPTH;
    else process.env.PM_TEST_DEPTH = original;
  }
});

test("scaled harness deadlines are integer milliseconds and reject invalid factors", () => {
  assert.equal(testTimeout(101, "1.5"), 152);
  assert.equal(testTimeout(30_000, "3"), 90_000);
  for (const value of ["", "0", "-1", "NaN", "Infinity", "100000000"]) assert.throws(() => testTimeout(100, value), /PM_TEST_TIME_SCALE/);
});

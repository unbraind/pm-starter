/**
 * Behavioral coverage for the docstring gate script.
 *
 * The gate is a release gate measured at the package's 100% thresholds, so a
 * test asserts both the clean path (the real repository passes) and the
 * violation path (an undocumented declaration is reported), the CLI entry point
 * that writes streams and sets the exit code, and the {@link runScriptEntry}
 * guard in each of its branches. Every assertion runs against {@link runGate}'s
 * returned strings or captured process streams, never against the analyzer
 * directly, so a regression in the gate's own wiring surfaces here rather than
 * only at release time.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { main, runGate, runScriptEntry } from "../scripts/docstring-gate.ts";

/**
 * Absolute path to `scripts/docstring-gate.ts`, matching what
 * `fileURLToPath(import.meta.url)` resolves to inside the script module so the
 * `process.argv[1]` guard in {@link runScriptEntry} evaluates to true.
 */
const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "docstring-gate.ts");

test("docstring gate runGate returns success for the real repository root", () => {
  const root = resolve(import.meta.dirname, "..");
  const result = runGate(root);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /docstring-gate:.*file\(s\).*documented/);
  assert.equal(result.stderr, "");
});

test("docstring gate runGate reports violations for an undocumented source", () => {
  const root = mkdtempSync(join(tmpdir(), "pm-starter-docstring-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export function undocumented(): void {}\n");
    const result = runGate(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /undocumented: no docstring/);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("docstring gate main writes violations to stderr and sets the exit code", () => {
  const root = mkdtempSync(join(tmpdir(), "pm-starter-docstring-main-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export function undocumented(): void {}\n");
    const originalExitCode = process.exitCode;
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    let stdout = "";
    let stderr = "";
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderr += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
    process.exitCode = undefined;
    let observedExitCode: number | string | undefined;
    try {
      main(root);
    } finally {
      observedExitCode = process.exitCode;
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      process.exitCode = originalExitCode;
    }
    assert.equal(observedExitCode, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /undocumented: no docstring/);
    // main appends the newline so the next release:check step starts on its own
    // line rather than butting against this gate output.
    assert.match(stderr, /\n$/, "stderr must be newline-terminated");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("docstring gate main writes a success line to stdout and exits 0", () => {
  // The real repository is fully documented, so main() takes the success path:
  // non-empty stdout is terminated with a newline and exitCode stays 0. This
  // covers the stdout-newline branch the violation-only main test cannot.
  const root = resolve(import.meta.dirname, "..");
  const originalExitCode = process.exitCode;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  let observedExitCode: number | string | undefined;
  try {
    main(root);
  } finally {
    observedExitCode = process.exitCode;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
  }
  assert.equal(observedExitCode, 0);
  assert.match(stdout, /docstring-gate:.*documented\.\n$/);
});

test("runScriptEntry does nothing when argv[1] is falsy (guard short-circuits)", () => {
  const savedArgv1 = process.argv[1];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalExitCode = process.exitCode;
  let wrote = false;
  process.argv[1] = undefined as unknown as string;
  process.stdout.write = (() => {
    wrote = true;
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  try {
    runScriptEntry(resolve(import.meta.dirname, ".."));
    assert.equal(wrote, false, "should not write anything when argv[1] is falsy");
    assert.equal(process.exitCode, undefined, "should not set an exit code when argv[1] is falsy");
  } finally {
    process.argv[1] = savedArgv1;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
  }
});

test("runScriptEntry does nothing when argv[1] does not match the script path", () => {
  const savedArgv1 = process.argv[1];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalExitCode = process.exitCode;
  let wrote = false;
  process.argv[1] = "/some/other/script.ts";
  process.stdout.write = (() => {
    wrote = true;
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  try {
    runScriptEntry(resolve(import.meta.dirname, ".."));
    assert.equal(wrote, false, "should not write anything when argv[1] does not match");
    assert.equal(process.exitCode, undefined, "should not set an exit code when argv[1] does not match");
  } finally {
    process.argv[1] = savedArgv1;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
  }
});

test("runScriptEntry runs main when argv[1] matches the script path", () => {
  // The guard's true branch: argv[1] resolves to this script, so runScriptEntry
  // calls main() over the real (fully documented) repo, writing the success
  // line to stdout and leaving exitCode at 0.
  const savedArgv1 = process.argv[1];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalExitCode = process.exitCode;
  let stdout = "";
  process.argv[1] = SCRIPT_PATH;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  let observedExitCode: number | string | undefined;
  try {
    runScriptEntry(resolve(import.meta.dirname, ".."));
    observedExitCode = process.exitCode;
  } finally {
    process.argv[1] = savedArgv1;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
  }
  assert.equal(observedExitCode, 0);
  assert.match(stdout, /docstring-gate:.*documented\.\n$/);
});

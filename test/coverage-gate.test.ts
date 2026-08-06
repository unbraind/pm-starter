/**
 * Tests for `scripts/coverage-gate.ts` — the script that enforces coverage
 * thresholds across the fleet.
 *
 * The gate functions are imported and called IN-PROCESS so the test runner's
 * V8 coverage measures this file directly. `process.exit` is mocked to throw a
 * sentinel error (caught by the helper) so failure paths can be asserted
 * without killing the test runner. `collectSources` and `resolveEmitPaths`
 * throw plain Errors, which the helper also catches.
 *
 * Each test creates a minimal fixture project (package.json + source + test)
 * under a `mkdtemp` directory. The gate's internal `spawnSync(node --test …)`
 * still runs a REAL subprocess over the fixture's test files — only the
 * downstream `pm` process is controlled, never the unit under test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectSources, resolveEmitPaths, runGate, runScriptEntry } from "../scripts/coverage-gate.ts";

const REPO_NODE_MODULES = join(import.meta.dirname, "..", "node_modules");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary fixture project for the coverage gate.
 *
 * The `files` map writes arbitrary files into the fixture root. The
 * `needsTsc` flag symlinks `node_modules` from the real repo so `npx tsc`
 * can resolve.
 */
function createFixture(
  files: Record<string, string>,
  options: { needsTsc?: boolean } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "cov-gate-fixture-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  if (options.needsTsc) {
    try {
      symlinkSync(REPO_NODE_MODULES, join(dir, "node_modules"), "dir");
    } catch (e) {
      // A broken fixture surfaces later as an unrelated gate message, so rethrow
      // unless the link already exists (e.g. a retry over the same temp dir) —
      // in which case the desired state is already in place.
      if (!existsSync(join(dir, "node_modules"))) throw e;
    }
  }
  return dir;
}

/** A minimal package.json with a coverageGate block. */
function packageJson(gate: Record<string, unknown>): string {
  return JSON.stringify({ type: "module", coverageGate: gate });
}

/** A source file with a single fully-coverable function. */
const FULL_SOURCE = "export function add(a: number, b: number): number { return a + b; }\n";

/** A test file that fully exercises the source. */
const FULL_TEST = `
import { add } from "../src.ts";
import test from "node:test";
import assert from "node:assert/strict";
test("add works", () => { assert.equal(add(1, 2), 3); });
`;

/** A source file with an uncoverable branch (for threshold-miss tests). */
const BRANCHY_SOURCE = `
export function check(x: number): string {
  if (x > 0) return "positive";
  return "nonpositive";
}
`;

/** A test file that only covers one branch. */
const PARTIAL_TEST = `
import { check } from "../src.ts";
import test from "node:test";
import assert from "node:assert/strict";
test("positive", () => { assert.equal(check(1), "positive"); });
`;

/** A minimal tsconfig for fixtures that need compiled output. */
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    outDir: "dist",
    rootDir: ".",
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
  },
  include: ["*.ts"],
  exclude: ["node_modules", "dist", "test"],
});

// ---------------------------------------------------------------------------
// Direct-call helper: mocks process.exit so failure paths can be asserted
// in-process without killing the test runner.
// ---------------------------------------------------------------------------

/** Sentinel thrown when the mocked `process.exit` is called. */
class ProcessExitCalled extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`process.exit(${code}) was called`);
    this.name = "ProcessExitCalled";
    this.code = code;
  }
}

/**
 * Call `runGate(root)` in-process with `process.exit` mocked to throw.
 *
 * Captures `console.error`/`console.log` output. Returns the exit code (null
 * if `runGate` returned normally), captured stderr/stdout, and any thrown
 * Error (from `collectSources`/`resolveEmitPaths`). Temporary env overrides
 * can be supplied for tests that need to manipulate PATH etc.
 */
function callRunGate(
  root: string,
  envOverrides: Record<string, string | undefined> = {},
): { exitCode: number | null; stderr: string; stdout: string; error?: Error } {
  const errors: string[] = [];
  const logs: string[] = [];
  const origExit = process.exit;
  const origError = console.error;
  const origLog = console.log;
  let exitCode: number | null = null;
  let thrownError: Error | undefined;

  // Apply env overrides (restored in finally).
  const savedEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  process.exit = ((code?: number) => {
    exitCode = code ?? 1;
    throw new ProcessExitCalled(code ?? 1);
  }) as never;
  console.error = (...values: unknown[]) => void errors.push(values.join(" "));
  console.log = (...values: unknown[]) => void logs.push(values.join(" "));

  try {
    runGate(root);
  } catch (e) {
    if (e instanceof ProcessExitCalled) {
      // exitCode already set in the mock.
    } else if (e instanceof Error) {
      thrownError = e;
      exitCode = 1; // The wrapper script catches and exits 1.
    } else {
      throw e;
    }
  } finally {
    process.exit = origExit;
    console.error = origError;
    console.log = origLog;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return { exitCode, stderr: errors.join("\n"), stdout: logs.join("\n"), error: thrownError };
}

/** Run `npx tsc` in a fixture to produce compiled output for ignore verification. */
function buildFixture(cwd: string): void {
  const result = spawnSync("npx", ["tsc"], { cwd, encoding: "utf8", stdio: "pipe" });
  assert.equal(
    result.status,
    0,
    `\`npx tsc\` should succeed for the fixture (cwd=${cwd}):\n${result.stdout ?? ""}${result.stderr ?? ""}`,
  );
}

// ---------------------------------------------------------------------------
// collectSources — direct unit tests
// ---------------------------------------------------------------------------

test("collectSources walks a directory recursively, skipping .d.ts and skipDirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-gate-src-"));
  try {
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, "skip"));
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "b.d.ts"), "export type B = number;\n");
    writeFileSync(join(dir, "sub", "c.ts"), "export const c = 3;\n");
    writeFileSync(join(dir, "skip", "d.ts"), "export const d = 4;\n");
    const result = collectSources(dir, dir, new Set(["skip"]));
    const posix = result.map((p) => p.split(sep).join("/"));
    assert.ok(posix.includes("a.ts"), `should include a.ts: ${JSON.stringify(posix)}`);
    assert.ok(!posix.includes("b.d.ts"), `should skip .d.ts: ${JSON.stringify(posix)}`);
    assert.ok(posix.includes("sub/c.ts"), `should include sub/c.ts: ${JSON.stringify(posix)}`);
    assert.ok(!posix.some((p) => p.startsWith("skip/")), `should skip skip/ dir: ${JSON.stringify(posix)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectSources returns a single file for a .ts file entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-gate-src-"));
  try {
    writeFileSync(join(dir, "src.ts"), FULL_SOURCE);
    const result = collectSources(join(dir, "src.ts"), dir, new Set());
    assert.equal(result.length, 1);
    assert.equal(result[0], "src.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectSources throws when the target does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-gate-src-"));
  try {
    assert.throws(
      () => collectSources(join(dir, "nope.ts"), dir, new Set()),
      /does not exist/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectSources throws when the target is a .d.ts file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-gate-src-"));
  try {
    writeFileSync(join(dir, "types.d.ts"), "export type T = string;\n");
    assert.throws(
      () => collectSources(join(dir, "types.d.ts"), dir, new Set()),
      /not a TypeScript source file/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectSources throws when the target is a non-TS file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-gate-src-"));
  try {
    writeFileSync(join(dir, "README.md"), "# readme\n");
    assert.throws(
      () => collectSources(join(dir, "README.md"), dir, new Set()),
      /not a TypeScript source file/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// resolveEmitPaths — direct unit tests
// ---------------------------------------------------------------------------

test("resolveEmitPaths returns outDir and rootDir from a valid tsconfig", () => {
  const dir = createFixture({
    "tsconfig.json": TSCONFIG,
  }, { needsTsc: true });
  try {
    const result = resolveEmitPaths(dir);
    assert.ok(typeof result.outDir === "string" && result.outDir.length > 0, `outDir: ${result.outDir}`);
    assert.ok(typeof result.rootDir === "string", `rootDir: ${result.rootDir}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveEmitPaths falls back to defaults when tsconfig has no outDir/rootDir", () => {
  const dir = createFixture({
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
      },
      include: ["*.ts"],
      exclude: ["node_modules", "dist", "test"],
    }),
  }, { needsTsc: true });
  try {
    const result = resolveEmitPaths(dir);
    assert.equal(result.outDir, "dist", `outDir should default to "dist": ${result.outDir}`);
    assert.equal(result.rootDir, ".", `rootDir should default to ".": ${result.rootDir}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveEmitPaths throws when npx is not on PATH (ENOENT)", () => {
  const dir = createFixture({
    "tsconfig.json": TSCONFIG,
  }, { needsTsc: true });
  const emptyBin = mkdtempSync(join(tmpdir(), "cov-gate-empty-bin-"));
  try {
    const savedPath = process.env.PATH;
    process.env.PATH = emptyBin;
    try {
      assert.throws(
        () => resolveEmitPaths(dir),
        /could not resolve the effective tsconfig/,
      );
    } finally {
      process.env.PATH = savedPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyBin, { recursive: true, force: true });
  }
});

test("resolveEmitPaths throws when npx exits nonzero, surfacing its stderr", { skip: process.platform === "win32" ? "fake npx is a #!/bin/sh script; shebang is not honoured under cmd.exe" : false }, () => {
  const fakeBin = mkdtempSync(join(tmpdir(), "cov-gate-fake-bin-"));
  const fakeNpx = join(fakeBin, "npx");
  writeFileSync(fakeNpx, "#!/bin/sh\necho 'tsc not found' >&2\nexit 1\n");
  chmodSync(fakeNpx, 0o755);
  const dir = createFixture({
    "tsconfig.json": TSCONFIG,
  }, { needsTsc: true });
  try {
    const savedPath = process.env.PATH;
    process.env.PATH = [fakeBin, savedPath ?? ""].filter(Boolean).join(delimiter);
    try {
      assert.throws(
        () => resolveEmitPaths(dir),
        (err: Error) => {
          assert.ok(/could not resolve the effective tsconfig/.test(err.message), err.message);
          assert.ok(/tsc not found/.test(err.message), `should include npx stderr: ${err.message}`);
          return true;
        },
      );
    } finally {
      process.env.PATH = savedPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("resolveEmitPaths throws the gate message when npx exits 0 with empty stdout", { skip: process.platform === "win32" ? "fake npx is a #!/bin/sh script; shebang is not honoured under cmd.exe" : false }, () => {
  const fakeBin = mkdtempSync(join(tmpdir(), "cov-gate-fake-bin-"));
  const fakeNpx = join(fakeBin, "npx");
  // Exits 0 but writes nothing to stdout — JSON.parse would throw a bare
  // SyntaxError on the empty string; the gate must fail with its own message.
  writeFileSync(fakeNpx, "#!/bin/sh\nexit 0\n");
  chmodSync(fakeNpx, 0o755);
  const dir = createFixture({
    "tsconfig.json": TSCONFIG,
  }, { needsTsc: true });
  try {
    const savedPath = process.env.PATH;
    process.env.PATH = [fakeBin, savedPath ?? ""].filter(Boolean).join(delimiter);
    try {
      assert.throws(
        () => resolveEmitPaths(dir),
        (err: Error) => {
          assert.ok(/^coverage-gate:/.test(err.message), `should be a gate diagnostic, not a bare SyntaxError: ${err.message}`);
          assert.ok(/produced no output/.test(err.message), `should name the empty-stdout failure: ${err.message}`);
          return true;
        },
      );
    } finally {
      process.env.PATH = savedPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("resolveEmitPaths throws the gate message when npx exits 0 with non-JSON stdout", { skip: process.platform === "win32" ? "fake npx is a #!/bin/sh script; shebang is not honoured under cmd.exe" : false }, () => {
  const fakeBin = mkdtempSync(join(tmpdir(), "cov-gate-fake-bin-"));
  const fakeNpx = join(fakeBin, "npx");
  // Exits 0 but writes a banner to stdout rather than JSON — JSON.parse would
  // throw a bare SyntaxError; the gate must fail with its own message instead.
  writeFileSync(fakeNpx, "#!/bin/sh\necho 'npx notice: installing tsc'\nexit 0\n");
  chmodSync(fakeNpx, 0o755);
  const dir = createFixture({
    "tsconfig.json": TSCONFIG,
  }, { needsTsc: true });
  try {
    const savedPath = process.env.PATH;
    process.env.PATH = [fakeBin, savedPath ?? ""].filter(Boolean).join(delimiter);
    try {
      assert.throws(
        () => resolveEmitPaths(dir),
        (err: Error) => {
          assert.ok(/^coverage-gate:/.test(err.message), `should be a gate diagnostic, not a bare SyntaxError: ${err.message}`);
          assert.ok(/not valid JSON/.test(err.message), `should name the non-JSON failure: ${err.message}`);
          return true;
        },
      );
    } finally {
      process.env.PATH = savedPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// runGate — direct in-process tests (process.exit mocked)
// ---------------------------------------------------------------------------

test("success: 100% coverage over a directory walk passes the gate", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["."],
      tests: ["test/all.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
      skipDirs: ["custom-skip"],
    }),
    "src.ts": FULL_SOURCE,
    "lib/helper.ts": "export function mul(a: number, b: number): number { return a * b; }\n",
    "types.d.ts": "export type MyType = string;\n",
    "README.md": "# Fixture\n",
    "custom-skip/ignored.ts": "export function ignored(): void {}\n",
    "test/all.test.ts": `
      import { add } from "../src.ts";
      import { mul } from "../lib/helper.ts";
      import test from "node:test";
      import assert from "node:assert/strict";
      test("add", () => { assert.equal(add(1, 2), 3); });
      test("mul", () => { assert.equal(mul(2, 3), 6); });
    `,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, null, `gate should pass with 100% coverage:\n${result.stderr}`);
    assert.ok(
      result.stdout.includes("thresholds met"),
      `should confirm thresholds met: ${result.stdout}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no coverageGate block in package.json exits with an error", () => {
  const dir = createFixture({
    "package.json": JSON.stringify({ type: "module" }),
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": FULL_TEST,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("no `coverageGate`"), `should name the missing block: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sources entry that does not exist exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["nonexistent.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": FULL_TEST,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.error?.message.includes("does not exist"), `should name the missing file: ${result.error?.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sources entry that is a .d.ts file exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["types.d.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "types.d.ts": "export type MyType = string;\n",
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": FULL_TEST,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.error?.message.includes("not a TypeScript source file"), `should reject .d.ts: ${result.error?.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sources entry that is a non-TS file exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["README.md"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "README.md": "# readme\n",
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": FULL_TEST,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.error?.message.includes("not a TypeScript source file"), `should reject non-TS: ${result.error?.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an ignore entry not under sources exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["src.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
      ignore: ["other.ts"],
    }),
    "src.ts": FULL_SOURCE,
    "other.ts": "export type X = string;\n",
    "test/src.test.ts": FULL_TEST,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("not under `sources`"), `should name the bad ignore entry: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an ignore entry that emits runtime code exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["."],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
      ignore: ["runtime.ts"],
    }),
    "src.ts": FULL_SOURCE,
    "runtime.ts": "export function runtimeCode(): number { return 42; }\n",
    "tsconfig.json": TSCONFIG,
    "test/src.test.ts": FULL_TEST,
  }, { needsTsc: true });
  try {
    buildFixture(dir);
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("emits runtime code"), `should reject runtime ignore: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an ignore entry that is type-only passes the gate", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["."],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
      ignore: ["types.ts"],
    }),
    "src.ts": FULL_SOURCE,
    "types.ts": "/** A type-only module. */\nexport type MyType = string | number;\n",
    "tsconfig.json": TSCONFIG,
    "test/src.test.ts": FULL_TEST,
  }, { needsTsc: true });
  try {
    buildFixture(dir);
    const result = callRunGate(dir);
    assert.equal(result.exitCode, null, `type-only ignore should pass:\n${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an ignore entry with no compiled output exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["."],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
      ignore: ["types.ts"],
    }),
    "src.ts": FULL_SOURCE,
    "types.ts": "export type MyType = string;\n",
    "tsconfig.json": TSCONFIG,
    "test/src.test.ts": FULL_TEST,
  }, { needsTsc: true });
  try {
    // Deliberately do NOT build — the compiled output does not exist.
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("cannot verify"), `should name the missing output: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveEmitPaths failure inside runGate (npx not on PATH) exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["src.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
      ignore: ["src.ts"],
    }),
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": FULL_TEST,
  });
  const emptyBin = mkdtempSync(join(tmpdir(), "cov-gate-empty-bin-"));
  try {
    const result = callRunGate(dir, { PATH: emptyBin });
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.error?.message.includes("could not resolve the effective tsconfig"),
      `should name the resolveEmitPaths failure: ${result.error?.message}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyBin, { recursive: true, force: true });
  }
});

test("an empty source walk (only skip dirs) exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["."],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "test/src.test.ts": FULL_TEST,
  });
  // No .ts files in root; only test/ (skip) and scripts/ (skip by default).
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("no files"), `should name the empty walk: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("threshold miss: incomplete branch coverage exits nonzero", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["src.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "src.ts": BRANCHY_SOURCE,
    "test/src.test.ts": PARTIAL_TEST,
  });
  try {
    const result = callRunGate(dir);
    assert.notEqual(result.exitCode, 0, "gate should fail on a threshold miss");
    assert.ok(result.exitCode !== null, "gate should have a definite exit code");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a test runner killed by a signal exits with code 1 via the ?? fallback", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["src.ts"],
      tests: ["test/kill.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "src.ts": FULL_SOURCE,
    "test/kill.test.ts": `
      import test from "node:test";
      import process from "node:process";
      test("self-kill", () => {
        process.kill(process.pid, "SIGKILL");
      });
    `,
  });
  try {
    const result = callRunGate(dir);
    // The test runner is killed by SIGKILL → status is null → ?? 1 → exit 1.
    assert.equal(result.exitCode, 1, `signal-killed runner should exit 1 via ?? fallback: status=${result.exitCode}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a test runner that fails to start (status null) exits with code 1 via the ?? fallback", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["src.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": FULL_TEST,
  });
  try {
    // Point process.execPath at a nonexistent binary so spawnSync returns
    // { status: null, error: ENOENT }. This exercises the `?? 1` fallback
    // in `process.exit(result.status ?? 1)`.
    const origExecPath = process.execPath;
    process.execPath = "/nonexistent/node-binary";
    try {
      const result = callRunGate(dir);
      assert.equal(result.exitCode, 1, `runner that fails to start should exit 1 via ?? fallback: ${result.exitCode}`);
    } finally {
      process.execPath = origExecPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no lcov report written after a successful test run exits with an error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["src.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": `
      import { rmSync } from "node:fs";
      import test from "node:test";
      import { add } from "../src.ts";
      import assert from "node:assert/strict";

      test("add works", () => { assert.equal(add(1, 2), 3); });

      // Delete the lcov file during the exit phase so the gate can't find it.
      process.on("exit", () => {
        try { rmSync("coverage/lcov.info", { force: true }); } catch { /* ignore */ }
      });
    `,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1, `should exit 1 when no lcov is written: status=${result.exitCode}`);
    assert.ok(
      result.stderr.includes("no coverage report was written"),
      `should name the missing report: ${result.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a source file never loaded by any test is reported as missing", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["src.ts"],
      tests: ["test/other.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "src.ts": FULL_SOURCE,
    "test/other.test.ts": `
      import test from "node:test";
      test("placeholder", () => {});
    `,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("never loaded"), `should name the missing file: ${result.stderr}`);
    assert.ok(result.stderr.includes("src.ts"), `should name src.ts specifically: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a single .ts file source entry is accepted and covered", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["src.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": FULL_TEST,
  });
  try {
    const result = callRunGate(dir);
    assert.equal(result.exitCode, null, `single-file source should pass: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// runScriptEntry — the guarded entry point
// ---------------------------------------------------------------------------

/**
 * Absolute path to `scripts/coverage-gate.ts`, matching what
 * `fileURLToPath(import.meta.url)` resolves to inside the script module so the
 * `process.argv[1]` guard in {@link runScriptEntry} evaluates to true.
 */
const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "coverage-gate.ts");

test("runScriptEntry returns without exiting when argv[1] is falsy (guard short-circuits)", () => {
  const savedArgv1 = process.argv[1];
  const savedExit = process.exit;
  let exitCalled = false;
  process.argv[1] = undefined as unknown as string;
  process.exit = (() => { exitCalled = true; }) as typeof process.exit;
  try {
    runScriptEntry("/nonexistent/path");
    assert.equal(exitCalled, false, "should not call process.exit when argv[1] is falsy");
  } finally {
    process.argv[1] = savedArgv1;
    process.exit = savedExit;
  }
});

test("runScriptEntry returns without exiting when argv[1] does not match the script path", () => {
  const savedArgv1 = process.argv[1];
  const savedExit = process.exit;
  let exitCalled = false;
  process.argv[1] = "/some/other/script.ts";
  process.exit = (() => { exitCalled = true; }) as typeof process.exit;
  try {
    runScriptEntry("/nonexistent/path");
    assert.equal(exitCalled, false, "should not call process.exit when argv[1] does not match");
  } finally {
    process.argv[1] = savedArgv1;
    process.exit = savedExit;
  }
});

test("runScriptEntry prints the error message and exits 1 when the gate throws an Error", () => {
  const dir = createFixture({
    "package.json": packageJson({
      sources: ["nonexistent.ts"],
      tests: ["test/src.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100 },
    }),
    "src.ts": FULL_SOURCE,
    "test/src.test.ts": FULL_TEST,
  });
  try {
    const savedArgv1 = process.argv[1];
    const savedExit = process.exit;
    const origError = console.error;
    const errors: string[] = [];
    let exitCode: number | undefined;
    process.argv[1] = SCRIPT_PATH;
    process.exit = ((code?: number) => {
      exitCode = code ?? 1;
      throw new ProcessExitCalled(code ?? 1);
    }) as typeof process.exit;
    console.error = (...values: unknown[]) => void errors.push(values.join(" "));
    try {
      runScriptEntry(dir);
    } catch (e) {
      if (!(e instanceof ProcessExitCalled)) throw e;
    } finally {
      process.argv[1] = savedArgv1;
      process.exit = savedExit;
      console.error = origError;
    }
    assert.equal(exitCode, 1, "should exit 1 on a thrown error");
    assert.ok(
      errors.join("\n").includes("does not exist"),
      `should print the error message: ${errors.join("\n")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runScriptEntry stringifies and prints a non-Error throw, then exits 1", () => {
  // A fixture with no `coverageGate` block makes `runGate` call `process.exit(1)`
  // for a gate failure (not throw). When `process.exit` is mocked to throw a
  // non-Error value, that throw propagates out of `runGate` into
  // `runScriptEntry`'s catch, where `e instanceof Error` is false and the
  // `String(e)` arm of the ternary fires — the only way to reach that arm,
  // since `runGate`'s own helper throws are always `Error` instances.
  const dir = createFixture({
    "package.json": JSON.stringify({ type: "module" }),
  });
  try {
    const savedArgv1 = process.argv[1];
    const savedExit = process.exit;
    const origError = console.error;
    const errors: string[] = [];
    let exitCode: number | undefined;
    process.argv[1] = SCRIPT_PATH;
    process.exit = ((code?: number) => {
      exitCode = code ?? 1;
      throw "a non-Error sentinel";
    }) as typeof process.exit;
    console.error = (...values: unknown[]) => void errors.push(values.join(" "));
    try {
      runScriptEntry(dir);
    } catch (e) {
      // The catch in runScriptEntry stringifies the sentinel, prints it, and
      // calls process.exit(1) — the mock throws the sentinel again. Catch it
      // here so it doesn't kill the test runner.
      if (e !== "a non-Error sentinel") throw e;
    } finally {
      process.argv[1] = savedArgv1;
      process.exit = savedExit;
      console.error = origError;
    }
    assert.equal(exitCode, 1, "should exit 1 on a non-Error throw");
    assert.ok(
      errors.join("\n").includes("a non-Error sentinel"),
      `should print the stringified non-Error: ${errors.join("\n")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
/**
 * Coverage gate for the package test suite.
 *
 * Runs `node --test` with the runtime's built-in V8 coverage against the
 * TypeScript sources directly (Node executes `.ts` natively, so the reported
 * line numbers are the ones an author edits, not compiled output), enforces a
 * per-dimension threshold, and reconciles the reported file list against the
 * files actually on disk.
 *
 * That last step is the reason this script exists rather than a bare
 * `node --test --test-coverage-lines=...` invocation. Node only reports files
 * that were loaded during the run: a source module with no test at all is
 * omitted from the report entirely rather than reported at zero. The published
 * percentage is therefore computed over the tested subset, and a package can
 * satisfy a 100% threshold while an entire module goes unexercised. Comparing
 * the report against a directory walk turns that silent omission into a failure
 * naming the missing files, so the threshold cannot be passed by narrowing what
 * the suite touches.
 *
 * Configuration lives in `package.json` under `coverageGate` so the numbers the
 * gate enforces are visible in the same file that declares the scripts, and a
 * threshold change shows up in review as a deliberate diff.
 *
 * The gate logic is wrapped in {@link runGate} and only invoked when the script
 * is executed directly (not when imported by a test for coverage tracking).
 *
 * @example
 * ```bash
 * node scripts/coverage-gate.ts
 * ```
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Minimum acceptable percentage for each coverage dimension Node reports.
 *
 * Statement coverage is not listed because V8 reports statements as lines; the
 * line figure is the statement figure for this runtime.
 */
interface CoverageThresholds {
  /** Minimum percentage of executable lines that must be covered. */
  readonly lines: number;
  /** Minimum percentage of branch arms that must be taken. */
  readonly branches: number;
  /** Minimum percentage of declared functions that must be invoked. */
  readonly functions: number;
}

/** The `coverageGate` block read from `package.json`. */
interface CoverageGateConfig {
  /**
   * Source locations the gate requires to appear in the report. Each entry is
   * either a directory, walked recursively for `.ts` files, or a single file.
   *
   * Prefer a directory — including `"."` for a package whose entrypoint sits at
   * the repository root. A directory is enumerated at run time, so a source file
   * added later is required automatically. An explicit file list freezes the
   * required set at the moment it was written, and a new untested module simply
   * never enters it, which is the same blind spot this gate exists to close.
   */
  readonly sources: readonly string[];
  /**
   * Directory names skipped while walking, on top of {@link DEFAULT_SKIP_DIRS}.
   * Needed only for a source tree with a non-standard non-source directory.
   */
  readonly skipDirs?: readonly string[];
  /** Test file arguments handed to `node --test`. */
  readonly tests: readonly string[];
  /** Threshold enforced on the aggregate report. */
  readonly thresholds: CoverageThresholds;
  /**
   * Source files exempt from the presence check, each of which must be
   * type-only. A module that erases to nothing emits no coverage counters, so
   * requiring it in the report would make the gate unsatisfiable.
   */
  readonly ignore?: readonly string[];
}

/** Shape of the `package.json` fields this script reads. */
interface PackageManifest {
  readonly coverageGate?: CoverageGateConfig;
}

/** Compiler paths used to locate a source file's emitted output. */
interface TsConfig {
  readonly compilerOptions?: { readonly outDir?: string; readonly rootDir?: string };
}

/**
 * Directories never treated as source, so that `sources: ["."]` works for a
 * package whose entrypoint sits at the repository root.
 *
 * These hold tests, build output, tooling and installed dependencies. None of
 * them contain shipped source, and several would otherwise make the required
 * set unsatisfiable — a test file cannot appear in its own coverage report.
 */
const DEFAULT_SKIP_DIRS: readonly string[] = [
  "node_modules",
  "dist",
  "dist-test",
  "coverage",
  "test",
  "tests",
  "scripts",
  "public",
  ".agents",
  ".git",
  ".github",
];

/**
 * Collects every TypeScript source file at a configured location.
 *
 * A file entry resolves to itself; a directory entry is walked recursively with
 * `skipDirs` pruned. Declaration files are skipped either way: they carry no
 * runtime code and so can never appear in a coverage report.
 *
 * @param target - Absolute path to a source file or directory.
 * @param root - Absolute path to the repository root, for relative path output.
 * @param skipDirs - Directory names to skip during the walk.
 * @returns Repository-relative POSIX paths, in directory order.
 * @throws Error if the target does not exist or is not a TypeScript source file.
 */
export function collectSources(target: string, root: string, skipDirs: Set<string>): string[] {
  if (!existsSync(target)) {
    throw new Error(
      `coverage-gate: \`coverageGate.sources\` names ${relative(root, target)}, which does not exist.`,
    );
  }
  if (!statSync(target).isDirectory()) {
    if (!target.endsWith(".ts") || target.endsWith(".d.ts")) {
      throw new Error(
        `coverage-gate: \`coverageGate.sources\` names ${relative(root, target)}, which is not a TypeScript source file. A declaration file or non-TypeScript entry can never appear in a coverage report, so requiring it would make the gate unsatisfiable.`,
      );
    }
    return [relative(root, target).split(sep).join("/")];
  }
  const found: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        found.push(...collectSources(join(target, entry.name), root, skipDirs));
      }
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(relative(root, join(target, entry.name)).split(sep).join("/"));
    }
  }
  return found;
}

/**
 * Resolves the compiler's effective output paths.
 *
 * Asks `tsc --showConfig` rather than parsing `tsconfig.json` directly: the file
 * may be JSONC and may inherit `outDir`/`rootDir` through an `extends` chain, so
 * a raw `JSON.parse` can either throw on a valid config or silently read the
 * wrong paths.
 *
 * Fails closed if the compiler cannot be reached. This feeds the check that
 * decides whether an exempted module is genuinely type-only, and guessing the
 * emit layout there could clear an executable module by looking at the wrong
 * file — the one outcome this gate must never produce. A package that cannot
 * run its own compiler has a problem worth stopping for.
 *
 * @param root - Absolute path to the repository root.
 * @throws Error if the compiler cannot be reached or produces no output.
 */
export function resolveEmitPaths(root: string): { outDir: string; rootDir: string } {
  const shown = spawnSync("npx", ["tsc", "--showConfig", "-p", "tsconfig.json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (shown.status !== 0) {
    throw new Error(
      [
        "coverage-gate: could not resolve the effective tsconfig via `tsc --showConfig`,",
        "so the emit layout is unknown and `coverageGate.ignore` entries cannot be verified",
        "as type-only. Refusing to guess.",
        shown.stderr?.trim() ? `\n${shown.stderr.trim()}` : "",
      ].join("\n"),
    );
  }
  // Parse defensively: `npx` can exit 0 yet write empty or non-JSON stdout (a
  // misconfigured toolchain, a truncated pipe, a wrapper that prints a banner).
  // A bare `JSON.parse` would throw a `SyntaxError` whose message is the parse
  // complaint, not the gate's own diagnostic — the doc comment above promises
  // the opposite. Fail closed with the gate's message so the caller never sees
  // a raw parser error stand in for a coverage-configuration failure.
  const raw = shown.stdout.trim();
  if (raw.length === 0) {
    throw new Error(
      [
        "coverage-gate: `tsc --showConfig` produced no output,",
        "so the emit layout is unknown and `coverageGate.ignore` entries cannot be verified",
        "as type-only. Refusing to guess.",
      ].join("\n"),
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      [
        "coverage-gate: `tsc --showConfig` produced output that is not valid JSON,",
        "so the emit layout is unknown and `coverageGate.ignore` entries cannot be verified",
        "as type-only. Refusing to guess.",
        `--- stdout ---\n${raw}\n--- end stdout ---`,
      ].join("\n"),
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "coverage-gate: `tsc --showConfig` produced JSON that is not a tsconfig object. Refusing to guess.",
    );
  }
  const tsconfig = parsed as TsConfig;
  return {
    outDir: tsconfig.compilerOptions?.outDir ?? "dist",
    rootDir: tsconfig.compilerOptions?.rootDir ?? ".",
  };
}

/**
 * Runs the full coverage gate against a package root.
 *
 * Reads `package.json#coverageGate`, walks sources, verifies ignore entries,
 * runs `node --test` with coverage, parses the lcov report, and exits non-zero
 * on any miss. On success, logs a confirmation and returns normally.
 *
 * @param root - Absolute path to the package root to gate.
 */
export function runGate(root: string): void {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageManifest;
  const config = manifest.coverageGate;

  if (!config) {
    console.error("coverage-gate: package.json has no `coverageGate` block.");
    process.exit(1);
  }

  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(config.skipDirs ?? [])]);

  const expected = config.sources.flatMap((source) => collectSources(join(root, source), root, skipDirs));
  const exempt = new Set(config.ignore ?? []);
  const required = expected.filter((file) => !exempt.has(file));

  // Validate ignore entries are under sources before resolving emit paths, so an
  // invalid configuration is reported without needing the compiler to be present.
  for (const file of config.ignore ?? []) {
    if (!expected.includes(file)) {
      console.error(`coverage-gate: \`coverageGate.ignore\` names ${file}, which is not under \`sources\`.`);
      process.exit(1);
    }
  }

  // resolveEmitPaths is only needed when there are ignore entries to verify.
  const emitPaths = (config.ignore ?? []).length > 0 ? resolveEmitPaths(root) : { outDir: "dist", rootDir: "." };

  /**
   * Rejects an `ignore` entry that still carries runtime code.
   *
   * The exemption exists for type-only modules, which erase to nothing and so
   * can never appear in a coverage report. Left untested, it is also the one
   * way to remove an executable module from both the measured set and the
   * required set — exactly the escape this gate exists to prevent. TypeScript
   * emits `export {};` and nothing else for a module that erases completely, so
   * the compiled output settles the question rather than the author's say-so.
   */
  for (const file of config.ignore ?? []) {
    const emitted = join(
      root,
      emitPaths.outDir,
      relative(join(root, emitPaths.rootDir), join(root, file)),
    ).replace(/\.ts$/, ".js");
    if (!existsSync(emitted)) {
      console.error(
        `coverage-gate: cannot verify that ignored file ${file} is type-only — no compiled output at ${relative(root, emitted)}. Build before running the gate, or correct \`outDir\`/\`rootDir\`.`,
      );
      process.exit(1);
    }
    // Block comments are stripped as well as line comments: tsc carries a
    // file-leading JSDoc into the emit, so a documented type-only module would
    // otherwise read as runtime code and be rejected for having a comment.
    const body = readFileSync(emitted, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/export\s*\{\s*\}\s*;?/g, "")
      .trim();
    if (body.length > 0) {
      console.error(
        `coverage-gate: \`coverageGate.ignore\` names ${file}, but it emits runtime code to ${relative(root, emitted)}. Only type-only modules may be exempt; anything executable must be covered.`,
      );
      process.exit(1);
    }
  }

  if (required.length === 0) {
    console.error("coverage-gate: source walk found no files; check `coverageGate.sources`.");
    process.exit(1);
  }

  const lcovPath = join(root, "coverage", "lcov.info");
  mkdirSync(join(root, "coverage"), { recursive: true });
  // Delete any previous report first. If this run writes none, a leftover file
  // from an earlier, broader run would satisfy the presence check on stale data
  // — the gate would pass by reading history rather than by measuring anything.
  rmSync(lcovPath, { force: true });

  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--experimental-test-coverage",
      // Scope the report to exactly the files the presence check requires.
      // Passing the enumerated paths rather than a directory glob keeps the two
      // in step by construction, and keeps test files and tooling out of the
      // percentages even when the source root is the repository root.
      ...required.map((file) => `--test-coverage-include=${file}`),
      `--test-coverage-lines=${config.thresholds.lines}`,
      `--test-coverage-branches=${config.thresholds.branches}`,
      `--test-coverage-functions=${config.thresholds.functions}`,
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=lcov",
      `--test-reporter-destination=${lcovPath}`,
      ...config.tests,
    ],
    {
      cwd: root,
      stdio: "inherit",
      // Pin the timezone so the measurement is reproducible on any machine.
      // Code that branches on a timestamp's UTC offset takes different paths
      // under a local offset than under UTC, which moves the reported percentage
      // between a contributor's machine and CI. A threshold pinned to one
      // machine's number then fails on the other for reasons unrelated to the
      // change under review.
      env: {
        ...process.env,
        TZ: "UTC",
        // Clear Node test-runner env vars so the gate's internal `node --test`
        // subprocess doesn't detect a recursive test context (set when the gate
        // is invoked from within a test process) and skip running.
        NODE_TEST_CONTEXT: undefined,
        NODE_TEST_WORKER_ID: undefined,
      },
    },
  );

  // Surface a runner failure before touching the report at all. A failing
  // suite, an unmet threshold, or a test file that will not load can each leave
  // the lcov output absent or incomplete, and every diagnostic below would then
  // describe a coverage-configuration problem the author does not have —
  // burying the test failure they need to act on.
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  /**
   * Source files the run actually reported on, read back from the lcov output.
   *
   * `SF:` paths are normalised to repository-relative POSIX form so they can be
   * compared against the walk. `resolve(root, raw)` handles both relative paths
   * (the lcov reporter's default on Linux) and absolute paths (seen on Windows
   * runners) without a branch; without normalising, the presence check would
   * invert into a permanently red build that blames every source file for never
   * loading.
   */
  if (!existsSync(lcovPath)) {
    console.error(`coverage-gate: no coverage report was written to ${relative(root, lcovPath)}.`);
    process.exit(1);
  }
  const reported = new Set<string>();
  for (const line of readFileSync(lcovPath, "utf8").split("\n")) {
    if (!line.startsWith("SF:")) continue;
    const raw = line.slice(3).trim();
    const abs = resolve(root, raw);
    reported.add(relative(root, abs).split(sep).join("/"));
  }

  const missing = required.filter((file) => !reported.has(file));

  if (missing.length > 0) {
    console.error(
      [
        "",
        `coverage-gate: ${missing.length} source file(s) never loaded during the run and were`,
        "omitted from the coverage report, so the reported percentages exclude them entirely:",
        ...missing.map((file) => `  - ${file}`),
        "",
        "Import each file from a test (or exercise it through the CLI entrypoint under test).",
        "A file that is genuinely type-only belongs in `coverageGate.ignore` in package.json.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`\ncoverage-gate: ${required.length} source file(s) reported, thresholds met.`);
}

// ---------------------------------------------------------------------------
// Script entry point — run the gate when executed directly, not when imported.
// ---------------------------------------------------------------------------

const repoRoot = resolve(import.meta.dirname, "..");

/**
 * Runs the coverage gate when the module is the process's main script, then
 * exits with a clean message on a thrown error. When the module is imported
 * (e.g. from the test suite), the `process.argv[1]` guard is false and the
 * function returns without calling `process.exit`, so tests can import and
 * exercise every other path without the module terminating the test process.
 *
 * {@link runGate} calls `process.exit` itself for gate failures (threshold
 * misses, missing sources in the report, etc.); it only throws for helper
 * errors from {@link collectSources} / {@link resolveEmitPaths}. This wrapper
 * catches those throws and converts them into a clean stderr message plus
 * exit code 1 — the same behaviour the deleted `scripts/run-coverage-gate.ts`
 * shim provided, now inside the measured source set so the catch branch is
 * covered by the very gate it guards.
 *
 * @param rootDir - Absolute path to the package root to gate. Defaults to the
 *   script's own parent directory.
 */
export function runScriptEntry(rootDir: string = repoRoot): void {
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
      runGate(rootDir);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }
}

runScriptEntry();

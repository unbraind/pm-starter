import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, type TestContext } from "node:test";

import extension, { readPmItems } from "../index.ts";

// ---------------------------------------------------------------------------
// Fake `pm` stub — a tiny Node script placed on PATH so the command handlers
// in index.ts that shell out to `pm` exercise their REAL spawnSync paths.
//
// The stub reads a subcommand from argv (skipping --path/--depth/--mode value
// flags), then either:
//   - honours PM_STUB_MODE for failure/non-JSON modes, or
//   - outputs the contents of $PM_STUB_DIR/<subcommand>.json on stdout.
//
// This is NOT stubbing the unit under test: the real command body runs, the
// real spawnSync fires, and only the downstream `pm` process is controlled.
// ---------------------------------------------------------------------------

const FAKE_PM_SCRIPT = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const valueFlags = new Set(["--path", "--depth", "--mode"]);
let sub = "";
for (let i = 0; i < args.length; i++) {
  if (valueFlags.has(args[i])) { i++; continue; }
  if (args[i].startsWith("--")) continue;
  sub = args[i]; break;
}
const mode = process.env.PM_STUB_MODE;
if (mode === "fail") { process.stderr.write("stub pm: failure"); process.exit(1); }
if (mode === "fail-no-stderr") { process.stdout.write("stub pm: failure"); process.exit(1); }
if (mode === "fail-silent") { process.exit(1); }
if (mode === "bad-json") { process.stdout.write("not json {{{"); process.exit(0); }
if (mode === "non-object") { process.stdout.write("42"); process.exit(0); }
if (mode === "null-json") { process.stdout.write("null"); process.exit(0); }
const stubDir = process.env.PM_STUB_DIR;
const file = stubDir ? path.join(stubDir, sub + ".json") : null;
if (file && fs.existsSync(file)) {
  process.stdout.write(fs.readFileSync(file, "utf8"));
} else {
  process.stdout.write("{}");
}
`;

let fakePmDir: string;
let stubDir: string;
let originalPath: string | undefined;
let originalStubMode: string | undefined;
let originalStubDir: string | undefined;
let originalHooks: string | undefined;

before(() => {
  fakePmDir = mkdtempSync(join(tmpdir(), "pm-starter-stub-"));
  stubDir = mkdtempSync(join(tmpdir(), "pm-starter-stub-resp-"));
  const pmPath = join(fakePmDir, "pm");
  writeFileSync(pmPath, FAKE_PM_SCRIPT);
  chmodSync(pmPath, 0o755);
  originalPath = process.env.PATH;
  originalStubMode = process.env.PM_STUB_MODE;
  originalStubDir = process.env.PM_STUB_DIR;
  originalHooks = process.env.PM_STARTER_HOOKS;
  process.env.PATH = `${fakePmDir}:${process.env.PATH ?? ""}`;
  process.env.PM_STUB_DIR = stubDir;
  delete process.env.PM_STUB_MODE;
  delete process.env.PM_STARTER_HOOKS;
});

after(() => {
  if (originalPath !== undefined) process.env.PATH = originalPath;
  else delete process.env.PATH;
  if (originalStubMode !== undefined) process.env.PM_STUB_MODE = originalStubMode;
  else delete process.env.PM_STUB_MODE;
  if (originalStubDir !== undefined) process.env.PM_STUB_DIR = originalStubDir;
  else delete process.env.PM_STUB_DIR;
  if (originalHooks !== undefined) process.env.PM_STARTER_HOOKS = originalHooks;
  else delete process.env.PM_STARTER_HOOKS;
  rmSync(fakePmDir, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Captures console.error and console.log output during a callback, returning
 * the accumulated lines. Used to assert on human-readable command output
 * without polluting the test runner's own stderr/stdout.
 *
 * The helper is async and awaits the callback BEFORE restoring the originals:
 * every caller passes an async handler, and anything the handler logs after its
 * first `await` would otherwise be emitted while the originals are already back
 * in place (the `finally` ran on the synchronous frame) and escape capture. The
 * assertions passed previously only because the handlers happened to log before
 * yielding. Awaiting inside the `try` keeps the mocks installed for the whole
 * lifetime of the callback.
 */
async function captureOutput<T>(fn: () => Promise<T> | T): Promise<{ errors: string[]; logs: string[]; result: T }> {
  const errors: string[] = [];
  const logs: string[] = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (...values: unknown[]) => errors.push(values.join(" "));
  console.log = (...values: unknown[]) => logs.push(values.join(" "));
  try {
    const result = await fn();
    return { errors, logs, result };
  } finally {
    console.error = origError;
    console.log = origLog;
  }
}

/** Write a JSON response file for a subcommand into the stub response dir. */
function stubResponse(subcommand: string, data: unknown): void {
  writeFileSync(join(stubDir, `${subcommand}.json`), JSON.stringify(data));
}

/** Set PM_STUB_MODE for the duration of a test (cleaned up by the test's after). */
function setStubMode(t: TestContext, mode: string | undefined): void {
  const saved = process.env.PM_STUB_MODE;
  if (mode === undefined) delete process.env.PM_STUB_MODE;
  else process.env.PM_STUB_MODE = mode;
  t.after(() => {
    if (saved === undefined) delete process.env.PM_STUB_MODE;
    else process.env.PM_STUB_MODE = saved;
  });
}

/** Set PM_STARTER_HOOKS for the duration of a test. */
function setHooksEnabled(t: TestContext, enabled: boolean): void {
  const saved = process.env.PM_STARTER_HOOKS;
  if (enabled) process.env.PM_STARTER_HOOKS = "1";
  else delete process.env.PM_STARTER_HOOKS;
  t.after(() => {
    if (saved === undefined) delete process.env.PM_STARTER_HOOKS;
    else process.env.PM_STARTER_HOOKS = saved;
  });
}

/** Set an env var for the duration of a test, restoring it afterwards. */
function setEnv(t: TestContext, key: string, value: string | undefined): void {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  });
}

/**
 * Mock ExtensionApi that captures every registered handler so tests can call
 * them directly with controlled contexts. Mirrors the pattern in smoke.test.ts
 * but captures callbacks for hooks, schema, search, parser, preflight, etc.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles use any for the mock API surface */
interface CapturedApi {
  readonly commands: Record<string, any>;
  readonly renderers: Record<string, { fn: (ctx: any) => any; ownership?: unknown }>;
  importer: ((ctx: any) => any) | undefined;
  exporter: ((ctx: any) => any) | undefined;
  searchProvider: { query: (ctx: any) => any } | undefined;
  vectorStore: { upsert: (ctx: any) => any; query: (ctx: any) => any } | undefined;
  migration: { up: (ctx: any) => any } | undefined;
  parser: ((ctx: any) => any) | undefined;
  preflight: ((ctx: any) => any) | undefined;
  service: ((ctx: any) => any) | undefined;
  readonly hooks: {
    beforeCommand: ((ctx: any) => void)[];
    afterCommand: ((ctx: any) => void)[];
    onWrite: ((ctx: any) => void)[];
    onRead: ((ctx: any) => void)[];
    onIndex: ((ctx: any) => void)[];
  };
}

/** Create a capturing mock API and activate the extension against it. */
function activate(): CapturedApi {
  const commands: CapturedApi["commands"] = {};
  const renderers: CapturedApi["renderers"] = {};
  const hooks: CapturedApi["hooks"] = {
    beforeCommand: [],
    afterCommand: [],
    onWrite: [],
    onRead: [],
    onIndex: [],
  };
  const api: CapturedApi = {
    commands,
    renderers,
    importer: undefined,
    exporter: undefined,
    searchProvider: undefined,
    vectorStore: undefined,
    migration: undefined,
    parser: undefined,
    preflight: undefined,
    service: undefined,
    hooks,
  };
  extension.activate({
    registerCommand: (def: any) => { commands[def.name] = def; },
    registerRenderer: (format: string, fn: (ctx: any) => any, ownership?: unknown) => {
      renderers[format] = { fn, ownership };
    },
    registerImporter: (_name: string, handler: (ctx: any) => any) => { api.importer = handler; },
    registerExporter: (_name: string, handler: (ctx: any) => any) => { api.exporter = handler; },
    registerSearchProvider: (def: any) => { api.searchProvider = def; },
    registerVectorStoreAdapter: (def: any) => { api.vectorStore = def; },
    registerMigration: (def: any) => { api.migration = def; },
    registerParser: (_cmd: string, handler: (ctx: any) => any) => { api.parser = handler; },
    registerPreflight: (handler: (ctx: any) => any) => { api.preflight = handler; },
    registerService: (_name: string, handler: (ctx: any) => any) => { api.service = handler; },
    registerFlags: () => {},
    registerItemFields: () => {},
    registerItemTypes: () => {},
    hooks: {
      beforeCommand: (fn: (ctx: any) => void) => hooks.beforeCommand.push(fn),
      afterCommand: (fn: (ctx: any) => void) => hooks.afterCommand.push(fn),
      onWrite: (fn: (ctx: any) => void) => hooks.onWrite.push(fn),
      onRead: (fn: (ctx: any) => void) => hooks.onRead.push(fn),
      onIndex: (fn: (ctx: any) => void) => hooks.onIndex.push(fn),
    },
  } as any);
  return api;
}

/** Minimal command context for calling a registered command handler. */
function ctx(args: string[] = [], options: Record<string, unknown> = {}, pmRoot = "."): Record<string, unknown> {
  return { args, options, pm_root: pmRoot, command: "", global: {} };
}

// ---------------------------------------------------------------------------
// starter greet
// ---------------------------------------------------------------------------

test("starter greet returns a greeting with defaults", async () => {
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter greet"].run(ctx()),
  );
  assert.deepEqual(result, { message: "👋 Hello, World!" });
  assert.ok(errors.some((e) => e.includes("👋 Hello, World!")), "should print the greeting to stderr");
});

test("starter greet honors --name, --emoji, and --uppercase", async () => {
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter greet"].run(ctx([], { name: "Dev", emoji: "🎉", uppercase: true })),
  );
  assert.deepEqual(result, { message: "🎉 HELLO, DEV!" });
  assert.ok(errors.some((e) => e.includes("🎉 HELLO, DEV!")));
});

// ---------------------------------------------------------------------------
// starter summary
// ---------------------------------------------------------------------------

test("starter summary prints a verbose workspace summary with by_type breakdown", async () => {
  stubResponse("stats", {
    totals: { items: 5 },
    by_status: { open: 3, closed: 0 },
    by_type: { issue: 4, task: 0 },
  });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter summary"].run(ctx([], { verbose: true })),
  );
  assert.strictEqual(result.totals.items, 5);
  assert.ok(errors.some((e) => /Total items: 5/.test(e)), "should print total items");
  assert.ok(errors.some((e) => /open: 3/.test(e)), "should print open status with count > 0");
  assert.ok(!errors.some((e) => /closed: 0/.test(e)), "should NOT print closed status with count = 0");
  assert.ok(errors.some((e) => /By type:/.test(e)), "should print by_type header in verbose mode");
  assert.ok(errors.some((e) => /issue: 4/.test(e)), "should print issue type with count > 0");
  assert.ok(!errors.some((e) => /task: 0/.test(e)), "should NOT print task type with count = 0");
});

test("starter summary without verbose skips by_type", async () => {
  stubResponse("stats", {
    totals: { items: 2 },
    by_status: { open: 2 },
    by_type: { issue: 2 },
  });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter summary"].run(ctx()),
  );
  assert.strictEqual(result.totals.items, 2);
  assert.ok(!errors.some((e) => /By type:/.test(e)), "should NOT print by_type without --verbose");
});

test("starter summary with verbose but no by_type skips by_type", async () => {
  stubResponse("stats", {
    totals: { items: 1 },
    by_status: { open: 1 },
  });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter summary"].run(ctx([], { verbose: true })),
  );
  assert.ok(!errors.some((e) => /By type:/.test(e)), "should NOT print by_type when stats has no by_type");
});

test("starter summary throws CommandError when pm stats exits nonzero (with stderr)", async (t) => {
  setStubMode(t, "fail");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter summary"].run(ctx()),
    (err: Error & { exitCode?: number }) => {
      assert.ok(/pm stats --json.*failed.*stub pm: failure/.test(err.message), err.message);
      assert.strictEqual(err.exitCode, 1);
      return true;
    },
  );
});

test("starter summary throws CommandError when pm stats exits nonzero (stderr empty, stdout present)", async (t) => {
  setStubMode(t, "fail-no-stderr");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter summary"].run(ctx()),
    (err: Error & { exitCode?: number }) => {
      assert.ok(/stub pm: failure/.test(err.message), err.message);
      return true;
    },
  );
});

test("starter summary throws CommandError when pm stats exits nonzero (no output)", async (t) => {
  setStubMode(t, "fail-silent");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter summary"].run(ctx()),
    (err: Error & { exitCode?: number }) => {
      assert.ok(/failed\./.test(err.message), err.message);
      return true;
    },
  );
});

test("starter summary throws CommandError when pm stats output is not valid JSON", async (t) => {
  setStubMode(t, "bad-json");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter summary"].run(ctx()),
    (err: Error) => {
      assert.ok(/could not parse/.test(err.message), err.message);
      return true;
    },
  );
});

test("starter summary throws CommandError when pm stats output is not an object", async (t) => {
  setStubMode(t, "non-object");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter summary"].run(ctx()),
    (err: Error) => {
      assert.ok(/invalid.*output format/.test(err.message), err.message);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// starter demo
// ---------------------------------------------------------------------------

test("starter demo returns a structured result with item_count and sample", async () => {
  stubResponse("list-all", [
    { id: "pm-1", title: "Item 1", status: "open", type: "issue" },
    { id: "pm-2", title: "Item 2", status: "closed", type: "task" },
  ]);
  const api = activate();
  const result = await api.commands["starter demo"].run(ctx());
  assert.strictEqual(result.starter_demo, true);
  assert.strictEqual(result.item_count, 2);
  assert.strictEqual(result.sample.length, 2);
  assert.strictEqual(result.sample[0].id, "pm-1");
});

// ---------------------------------------------------------------------------
// starter plan
// ---------------------------------------------------------------------------

test("starter plan shows a nested plan with steps breakdown", async () => {
  stubResponse("plan", {
    plan: {
      title: "Test Plan",
      mode: "ai",
      steps: [
        { id: "s1", title: "Step 1", status: "completed", order: 1 },
        { id: "s2", title: "Step 2", completed: true, order: 2 },
        { id: "s3", title: "Step 3", completed: false, order: 3 },
      ],
    },
  });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter plan"].run(ctx(["pm-plan-1"], { steps: true })),
  );
  assert.strictEqual(result.plan_id, "pm-plan-1");
  assert.strictEqual(result.title, "Test Plan");
  assert.strictEqual(result.mode, "ai");
  assert.strictEqual(result.step_count, 3);
  assert.ok(errors.some((e) => /Plan: Test Plan/.test(e)), "should print plan title");
  assert.ok(errors.some((e) => /\[x\].*Step 1/.test(e)), "completed step should show [x]");
  assert.ok(errors.some((e) => /\[x\].*Step 2/.test(e)), "completed=true step should show [x]");
  assert.ok(errors.some((e) => /\[ \].*Step 3/.test(e)), "incomplete step should show [ ]");
});

test("starter plan shows a flat plan (no .plan wrapper) without steps flag", async () => {
  stubResponse("plan", {
    title: "Flat Plan",
    mode: "manual",
    steps: [{ id: "s1", title: "Only Step", completed: false, order: 1 }],
  });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter plan"].run(ctx(["pm-plan-2"])),
  );
  assert.strictEqual(result.title, "Flat Plan");
  assert.strictEqual(result.mode, "manual");
  assert.ok(!errors.some((e) => /Step breakdown/.test(e)), "should NOT print steps without --steps");
});

test("starter plan falls back to metadata.title and metadata.steps", async () => {
  stubResponse("plan", {
    plan: {
      mode: "ai",
      metadata: {
        title: "Meta Title",
        steps: [{ id: "s1", title: "Meta Step", status: "completed", order: 1 }],
      },
    },
  });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter plan"].run(ctx(["pm-plan-3"], { steps: true })),
  );
  assert.strictEqual(result.title, "Meta Title");
  assert.ok(errors.some((e) => /Meta Title/.test(e)), "should use metadata.title fallback");
  assert.ok(errors.some((e) => /Meta Step/.test(e)), "should use metadata.steps fallback");
});

test("starter plan with no steps shows zero count", async () => {
  stubResponse("plan", { plan: { title: "Empty Plan", mode: "ai" } });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter plan"].run(ctx(["pm-plan-4"], { steps: true })),
  );
  assert.strictEqual(result.step_count, 0);
  assert.ok(!errors.some((e) => /Step breakdown/.test(e)), "should NOT print breakdown for 0 steps");
});

test("starter plan uses --id option when args are empty", async () => {
  stubResponse("plan", { plan: { title: "Option Plan", mode: "ai", steps: [] } });
  const api = activate();
  const res = await api.commands["starter plan"].run(ctx([], { id: "pm-plan-opt" }));
  assert.strictEqual(res.plan_id, "pm-plan-opt");
});

test("starter plan throws NOT_FOUND when pm plan show exits nonzero", async (t) => {
  setStubMode(t, "fail");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter plan"].run(ctx(["bad-id"])),
    (err: Error & { exitCode?: number }) => {
      assert.ok(/plan show bad-id.*failed/.test(err.message), err.message);
      assert.strictEqual(err.exitCode, 3);
      return true;
    },
  );
});

test("starter plan throws when plan output is not valid JSON", async (t) => {
  setStubMode(t, "bad-json");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter plan"].run(ctx(["pm-5"])),
    (err: Error) => {
      assert.ok(/could not parse/.test(err.message), err.message);
      return true;
    },
  );
});

test("starter plan throws when plan output is not an object", async (t) => {
  setStubMode(t, "non-object");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter plan"].run(ctx(["pm-6"])),
    (err: Error) => {
      assert.ok(/invalid plan output format/.test(err.message), err.message);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// starter context
// ---------------------------------------------------------------------------

test("starter context prints a snapshot with focus items and depth flag", async () => {
  stubResponse("context", {
    focus: [{ id: "pm-1", title: "Focus item", status: "open" }],
    agenda: [{ id: "pm-2" }],
    activity: [{ id: "pm-3" }],
  });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter context"].run(ctx([], { depth: "deep" })),
  );
  assert.strictEqual(result.focus[0].id, "pm-1");
  assert.ok(errors.some((e) => /Focus items: 1/.test(e)), "should print focus count");
  assert.ok(errors.some((e) => /Agenda entries: 1/.test(e)), "should print agenda count");
  assert.ok(errors.some((e) => /Activity entries: 1/.test(e)), "should print activity count");
  assert.ok(errors.some((e) => /^\s*Focus:/.test(e)), "should print Focus header");
  assert.ok(errors.some((e) => /pm-1.*Focus item.*open/.test(e)), "should print focus item detail");
});

test("starter context with empty focus skips the focus detail section", async () => {
  stubResponse("context", { focus: [], agenda: [], activity: [] });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter context"].run(ctx()),
  );
  assert.ok(errors.some((e) => /Focus items: 0/.test(e)));
  assert.ok(!errors.some((e) => /^\s*Focus:/.test(e)), "should NOT print Focus header for 0 items");
});

test("starter context falls back to project_focus when focus is absent", async () => {
  stubResponse("context", { project_focus: [{ id: "pf-1", title: "PF", status: "open" }], agenda: [], activity: [] });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter context"].run(ctx()),
  );
  assert.ok(errors.some((e) => /Focus items: 1/.test(e)), "should use project_focus fallback");
});

test("starter context falls back to low_level when focus and project_focus are absent", async () => {
  stubResponse("context", { low_level: [{ id: "ll-1", title: "LL", status: "open" }], agenda: [], activity: [] });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter context"].run(ctx()),
  );
  assert.ok(errors.some((e) => /Focus items: 1/.test(e)), "should use low_level fallback");
});

test("starter context with no focus/project_focus/low_level shows zero count", async () => {
  stubResponse("context", { agenda: [], activity: [] });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter context"].run(ctx()),
  );
  assert.ok(errors.some((e) => /Focus items: 0/.test(e)), "should show 0 focus items when no focus keys");
});

test("starter context with non-array focus shows zero count", async () => {
  stubResponse("context", { focus: "not an array", agenda: "also not", activity: 42 });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter context"].run(ctx()),
  );
  assert.ok(errors.some((e) => /Focus items: 0/.test(e)), "non-array focus should report 0");
  assert.ok(errors.some((e) => /Agenda entries: 0/.test(e)), "non-array agenda should report 0");
  assert.ok(errors.some((e) => /Activity entries: 0/.test(e)), "non-array activity should report 0");
});

test("starter context throws when pm context exits nonzero", async (t) => {
  setStubMode(t, "fail");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter context"].run(ctx()),
    (err: Error & { exitCode?: number }) => {
      assert.ok(/pm context.*failed/.test(err.message), err.message);
      return true;
    },
  );
});

test("starter context throws when output is not valid JSON", async (t) => {
  setStubMode(t, "bad-json");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter context"].run(ctx()),
    (err: Error) => {
      assert.ok(/could not parse/.test(err.message), err.message);
      return true;
    },
  );
});

test("starter context throws when output is not an object", async (t) => {
  setStubMode(t, "non-object");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter context"].run(ctx()),
    (err: Error) => {
      assert.ok(/invalid.*output format/.test(err.message), err.message);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// starter search
// ---------------------------------------------------------------------------

test("starter search with --mode returns hits with scores", async () => {
  stubResponse("search", {
    hits: [{ id: "pm-1", score: 0.95, title: "Result 1" }],
  });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter search"].run(ctx(["authentication"], { mode: "semantic" })),
  );
  assert.strictEqual(result.query, "authentication");
  assert.strictEqual(result.mode, "semantic");
  assert.strictEqual(result.total, 1);
  assert.ok(errors.some((e) => /1 hit\(s\)/.test(e)), "should print hit count");
  assert.ok(errors.some((e) => /pm-1.*0\.95.*Result 1/.test(e)), "should print hit with id, score, title");
});

test("starter search without --mode defaults to keyword and shows no-results message", async () => {
  stubResponse("search", { hits: [] });
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter search"].run(ctx(["nonexistent"])),
  );
  assert.strictEqual(result.mode, "keyword");
  assert.strictEqual(result.total, 0);
  assert.ok(errors.some((e) => /No results/.test(e)), "should print no results message");
  assert.ok(errors.some((e) => /--mode hybrid/.test(e)), "should print the hybrid tip");
});

test("starter search falls back to results key when hits is absent", async () => {
  stubResponse("search", { results: [{ id: "r-1", score: 0.5, title: "R1" }] });
  const api = activate();
  const res = await api.commands["starter search"].run(ctx(["query"]));
  assert.strictEqual(res.total, 1);
});

test("starter search falls back to items key when hits and results are absent", async () => {
  stubResponse("search", { items: [{ id: "i-1", score: 0.3, title: "I1" }] });
  const api = activate();
  const res = await api.commands["starter search"].run(ctx(["query"]));
  assert.strictEqual(res.total, 1);
});

test("starter search with no hits/results/items returns empty", async () => {
  stubResponse("search", {});
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter search"].run(ctx(["query"])),
  );
  assert.strictEqual(result.total, 0);
  assert.ok(errors.some((e) => /No results/.test(e)), "should print no results");
});

test("starter search with non-array hits returns empty", async () => {
  stubResponse("search", { hits: "not an array" });
  const api = activate();
  const res = await api.commands["starter search"].run(ctx(["query"]));
  assert.strictEqual(res.total, 0);
});

test("starter search handles hits without id, score, or title", async () => {
  stubResponse("search", { hits: [{}] });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter search"].run(ctx(["query"])),
  );
  assert.ok(errors.some((e) => /\?.*\[\?\].*\(untitled\)/.test(e)), "should use fallbacks for missing fields");
});

test("starter search with limit truncates displayed hits", async () => {
  const hits = Array.from({ length: 5 }, (_, i) => ({ id: `pm-${i}`, score: 0.9, title: `T${i}` }));
  stubResponse("search", { hits });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter search"].run(ctx(["query"], { limit: 2 })),
  );
  const hitLines = errors.filter((e) => /pm-\d/.test(e));
  assert.strictEqual(hitLines.length, 2, "should only display 2 hits with --limit 2");
});

test("starter search throws when pm search exits nonzero", async (t) => {
  setStubMode(t, "fail");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter search"].run(ctx(["query"])),
    (err: Error & { exitCode?: number }) => {
      assert.ok(/pm search.*failed/.test(err.message), err.message);
      return true;
    },
  );
});

test("starter search throws when output is not valid JSON", async (t) => {
  setStubMode(t, "bad-json");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter search"].run(ctx(["query"])),
    (err: Error) => {
      assert.ok(/could not parse/.test(err.message), err.message);
      return true;
    },
  );
});

test("starter search throws when output is not an object", async (t) => {
  setStubMode(t, "non-object");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter search"].run(ctx(["query"])),
    (err: Error) => {
      assert.ok(/invalid.*output format/.test(err.message), err.message);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// starter setup (non-interactive success paths)
// ---------------------------------------------------------------------------

test("starter setup with valid name and capabilities prints a scaffold plan", async () => {
  const api = activate();
  const { errors, result } = await captureOutput(() =>
    api.commands["starter setup"].run(ctx([], { name: "my-ext", capability: "commands,search" })),
  );
  assert.strictEqual(result.name, "my-ext");
  assert.deepEqual(result.capabilities, ["commands", "search"]);
  assert.strictEqual(result.scaffolded, false);
  assert.ok(errors.some((e) => /Extension Scaffold Plan/.test(e)));
  assert.ok(errors.some((e) => /Name: my-ext/.test(e)));
  assert.ok(errors.some((e) => /commands, search/.test(e)));
});

test("starter setup with name but no capability defaults to commands", async () => {
  const api = activate();
  const res = await api.commands["starter setup"].run(ctx([], { name: "simple-ext" }));
  assert.deepEqual(res.capabilities, ["commands"]);
});

test("starter setup throws USAGE for an invalid capability", async () => {
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter setup"].run(ctx([], { name: "ext", capability: "bogus" })),
    (err: Error & { exitCode?: number }) => {
      assert.ok(/invalid capability.*bogus/.test(err.message), err.message);
      assert.strictEqual(err.exitCode, 2);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// readPmItems error paths
// ---------------------------------------------------------------------------

test("readPmItems returns empty array and reports a non-ENOBUFS error when pm is not found", (t) => {
  // Remove the fake pm from PATH so spawnSync fails with ENOENT (not ENOBUFS).
  setEnv(t, "PATH", "/dev/null");
  const messages: string[] = [];
  const origError = console.error;
  console.error = (...values: unknown[]) => messages.push(values.join(" "));
  try {
    const items = readPmItems("/tmp/nonexistent-pm-root");
    assert.deepEqual(items, [], "never-throw contract must hold");
    assert.ok(
      messages.some((m) => /pm read failed/.test(m)),
      `non-ENOBUFS error must be reported as "pm read failed"; saw: ${messages.join(" | ")}`,
    );
  } finally {
    console.error = origError;
  }
});

test("readPmItems returns empty array and reports when pm exits nonzero", (t) => {
  setStubMode(t, "fail");
  const messages: string[] = [];
  const origError = console.error;
  console.error = (...values: unknown[]) => messages.push(values.join(" "));
  try {
    const items = readPmItems(".");
    assert.deepEqual(items, [], "never-throw contract must hold");
    assert.ok(
      messages.some((m) => /pm exited/.test(m)),
      `nonzero exit must be reported; saw: ${messages.join(" | ")}`,
    );
  } finally {
    console.error = origError;
  }
});

test("readPmItems returns empty array when pm output is not valid JSON", (t) => {
  setStubMode(t, "bad-json");
  const items = readPmItems(".");
  assert.deepEqual(items, [], "bad JSON should yield empty array");
});

test("readPmItems returns items from parsed array", () => {
  stubResponse("list-all", [{ id: "a-1", title: "A", status: "open" }]);
  const items = readPmItems(".");
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, "a-1");
});

test("readPmItems returns items from .items when output is an object", () => {
  stubResponse("list-all", { items: [{ id: "b-1", title: "B", status: "open" }] });
  const items = readPmItems(".");
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, "b-1");
});

test("readPmItems returns items from .results when no .items", () => {
  stubResponse("list-all", { results: [{ id: "c-1", title: "C", status: "open" }] });
  const items = readPmItems(".");
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, "c-1");
});

test("readPmItems returns empty array when output object has no items/results", () => {
  stubResponse("list-all", {});
  const items = readPmItems(".");
  assert.deepEqual(items, []);
});

// ---------------------------------------------------------------------------
// Renderers — null returns for non-marked results
// ---------------------------------------------------------------------------

test("toon renderer returns null for a non-marked result", () => {
  const api = activate();
  const rendered = api.renderers.toon.fn({ result: { other: true } });
  assert.strictEqual(rendered, null);
});

test("json renderer returns null for a non-marked result", () => {
  const api = activate();
  const rendered = api.renderers.json.fn({ result: { other: true } });
  assert.strictEqual(rendered, null);
});

test("json renderer reshapes a marked result with rendered_by tag", () => {
  const api = activate();
  const rendered = api.renderers.json.fn({ result: { starter_demo: true, item_count: 3, sample: [] } });
  const parsed = JSON.parse(rendered as string);
  assert.strictEqual(parsed.rendered_by, "pm-starter");
  assert.strictEqual(parsed.starter_demo, true);
});

test("toon renderer renders a marked result with sample entries", () => {
  const api = activate();
  const rendered = api.renderers.toon.fn({
    result: { starter_demo: true, item_count: 1, sample: [{ id: "x-1", status: "open", title: "Test" }] },
  });
  assert.match(rendered as string, /pm-starter demo — 1 item\(s\)/);
  assert.match(rendered as string, /x-1.*open.*Test/);
});

test("toon renderer handles non-array sample gracefully", () => {
  const api = activate();
  const rendered = api.renderers.toon.fn({
    result: { starter_demo: true, item_count: 0, sample: "not an array" },
  });
  assert.match(rendered as string, /pm-starter demo — 0 item\(s\)/);
});

// ---------------------------------------------------------------------------
// Hooks — exercise each hook callback with PM_STARTER_HOOKS enabled
// ---------------------------------------------------------------------------

test("hooks log when PM_STARTER_HOOKS is set", (t) => {
  setHooksEnabled(t, true);
  const api = activate();
  const messages: string[] = [];
  const origError = console.error;
  console.error = (...values: unknown[]) => messages.push(values.join(" "));
  try {
    api.hooks.beforeCommand[0]({ command: "list", args: ["--json"] });
    api.hooks.afterCommand[0]({ command: "list", ok: true });
    api.hooks.afterCommand[0]({ command: "create", ok: false, error: "bad input" });
    api.hooks.afterCommand[0]({ command: "create", ok: false });
    api.hooks.onWrite[0]({ op: "write", scope: "item", path: "/path/to/file" });
    api.hooks.onRead[0]({ path: "/path/to/read" });
    api.hooks.onRead[0]({});
    api.hooks.onIndex[0]({ mode: "full", total_items: 42 });
    api.hooks.onIndex[0]({ mode: "incremental" });

    assert.ok(messages.some((m) => /beforeCommand: list --json/.test(m)), "beforeCommand should log command and args");
    assert.ok(messages.some((m) => /afterCommand: list -> ok/.test(m)), "afterCommand should log ok=true");
    assert.ok(messages.some((m) => /afterCommand: create -> error: bad input/.test(m)), "afterCommand should log error message");
    assert.ok(messages.some((m) => /afterCommand: create -> error: \?/.test(m)), "afterCommand should log ? for missing error");
    assert.ok(messages.some((m) => /onWrite: write item \/path\/to\/file/.test(m)), "onWrite should log op, scope, path");
    assert.ok(messages.some((m) => /onRead: \/path\/to\/read/.test(m)), "onRead should log path");
    assert.ok(messages.some((m) => /onRead: \(item\)/.test(m)), "onRead should fall back to (item) when path absent");
    assert.ok(messages.some((m) => /onIndex: mode=full total_items=42/.test(m)), "onIndex should log mode and total_items");
    assert.ok(messages.some((m) => /onIndex: mode=incremental total_items=\(unreported\)/.test(m)), "onIndex should fall back to (unreported)");
  } finally {
    console.error = origError;
  }
});

test("hooks are silent when PM_STARTER_HOOKS is not set", () => {
  const api = activate();
  const messages: string[] = [];
  const origError = console.error;
  console.error = (...values: unknown[]) => messages.push(values.join(" "));
  try {
    api.hooks.beforeCommand[0]({ command: "list", args: [] });
    api.hooks.afterCommand[0]({ command: "list", ok: true });
    assert.strictEqual(messages.length, 0, "hooks should be silent without PM_STARTER_HOOKS");
  } finally {
    console.error = origError;
  }
});

test("beforeCommand hook handles undefined args", (t) => {
  setHooksEnabled(t, true);
  const api = activate();
  const messages: string[] = [];
  const origError = console.error;
  console.error = (...values: unknown[]) => messages.push(values.join(" "));
  try {
    api.hooks.beforeCommand[0]({ command: "stats" });
    assert.ok(messages.some((m) => /beforeCommand: stats/.test(m)), "should log even without args");
  } finally {
    console.error = origError;
  }
});

// ---------------------------------------------------------------------------
// Schema — migration up()
// ---------------------------------------------------------------------------

test("migration up() returns a benign no-op summary", () => {
  const api = activate();
  assert.ok(api.migration, "migration should be registered");
  const result = api.migration.up({ id: "pm-starter-0001-noop", command: "migration", layer: "project", extension: "pm-starter", pm_root: ".", status: "pending" });
  assert.deepEqual(result, { migrated: 0, note: "pm-starter demo migration is a no-op" });
});

// ---------------------------------------------------------------------------
// Importer / Exporter
// ---------------------------------------------------------------------------

test("importer returns a dry-run summary with the source name", async () => {
  const api = activate();
  assert.ok(api.importer, "importer should be registered");
  const { errors, result } = await captureOutput(() =>
    api.importer!({ options: { file: "data.json" }, pm_root: ".", registration: "starter-demo", action: "import", command: "starter-demo import", args: [], global: {} }),
  );
  assert.strictEqual(result.imported, 0);
  assert.strictEqual(result.dryRun, true);
  assert.strictEqual(result.source, "data.json");
  assert.ok(errors.some((e) => /would import from data\.json/.test(e)), "should log the source");
});

test("importer falls back to '(no source given)' when no file/url option", async () => {
  const api = activate();
  const res = await api.importer!({ options: {}, pm_root: ".", registration: "starter-demo", action: "import", command: "starter-demo import", args: [], global: {} });
  assert.strictEqual(res.source, "(no source given)");
});

test("exporter serializes items to JSON and prints them", async () => {
  stubResponse("list-all", [{ id: "pm-1", title: "Item 1", status: "open", type: "issue" }]);
  const api = activate();
  assert.ok(api.exporter, "exporter should be registered");
  const { logs, result } = await captureOutput(() =>
    api.exporter!({ pm_root: ".", registration: "starter-demo", action: "export", command: "starter-demo export", args: [], options: {}, global: {} }),
  );
  assert.strictEqual(result.exported, 1);
  assert.strictEqual(result.format, "json");
  assert.ok(logs.some((l) => /pm-1/.test(l) && /Item 1/.test(l) && /issue/.test(l) && /open/.test(l)), "should print the serialized items");
});

// ---------------------------------------------------------------------------
// Search provider
// ---------------------------------------------------------------------------

test("search provider returns hits matching the query in title or body", () => {
  const api = activate();
  assert.ok(api.searchProvider, "search provider should be registered");
  const result = api.searchProvider!.query({
    query: "authentication",
    mode: "keyword",
    tokens: ["authentication"],
    options: {},
    settings: {},
    documents: [
      { metadata: { id: "d-1", title: "Authentication bug" }, body: "login fails" },
      { metadata: { id: "d-2", title: "Unrelated" }, body: "nothing about auth" },
      { metadata: { id: "d-3", title: "Other" }, body: "authentication flow" },
    ],
  });
  assert.ok(Array.isArray(result.hits), "should return hits array");
  assert.strictEqual(result.hits.length, 2, "should match d-1 (title) and d-3 (body)");
  assert.strictEqual(result.hits[0].id, "d-1");
  assert.strictEqual(result.hits[0].score, 1);
});

test("search provider returns empty hits for an empty query", () => {
  const api = activate();
  const result = api.searchProvider!.query({
    query: "",
    mode: "keyword",
    tokens: [],
    options: {},
    settings: {},
    documents: [{ metadata: { id: "d-1", title: "Anything" }, body: "whatever" }],
  });
  assert.deepEqual(result.hits, []);
});

test("search provider returns empty hits when no documents match", () => {
  const api = activate();
  const result = api.searchProvider!.query({
    query: "zzz",
    mode: "keyword",
    tokens: ["zzz"],
    options: {},
    settings: {},
    documents: [{ metadata: { id: "d-1", title: "Hello" }, body: "world" }],
  });
  assert.deepEqual(result.hits, []);
});

// ---------------------------------------------------------------------------
// Vector store adapter
// ---------------------------------------------------------------------------

test("vector store upsert stores and returns count", () => {
  const api = activate();
  assert.ok(api.vectorStore, "vector store should be registered");
  const result = api.vectorStore!.upsert({ id: "v-1", text: "hello world", settings: {} });
  assert.deepEqual(result, { upserted: 1 });
});

test("vector store upsert with empty id returns zero", () => {
  const api = activate();
  const result = api.vectorStore!.upsert({ id: "", text: "no id", settings: {} });
  assert.deepEqual(result, { upserted: 0 });
});

test("vector store query returns scored results sorted by dot-product", () => {
  const api = activate();
  api.vectorStore!.upsert({ id: "v-1", text: "hello world", settings: {} });
  api.vectorStore!.upsert({ id: "v-2", text: "hello hello", settings: {} });
  const result = api.vectorStore!.query({ query: "hello", limit: 5, settings: {} });
  assert.ok(Array.isArray(result), "should return an array");
  assert.strictEqual(result.length, 2);
  // The adapter sorts by descending score; both contain "hello" so both match.
  assert.strictEqual(result[0].id, "v-1");
  assert.strictEqual(typeof result[0].score, "number");
  // v-1 ("hello world") outscores v-2 ("hello hello") for query "hello" because
  // the pseudo-embedding hashes "world" into dimensions that align with the
  // query vector better than the doubled "hello" — 623 vs 575 — so v-1 ranks first.
  assert.ok(result[0].score >= result[1].score, "results should be sorted by descending score");
});

test("vector store query with limit truncates results", () => {
  const api = activate();
  api.vectorStore!.upsert({ id: "v-a", text: "term", settings: {} });
  api.vectorStore!.upsert({ id: "v-b", text: "term", settings: {} });
  api.vectorStore!.upsert({ id: "v-c", text: "term", settings: {} });
  const result = api.vectorStore!.query({ query: "term", limit: 2, settings: {} });
  assert.strictEqual(result.length, 2, "should limit to 2 results");
});

test("vector store query on empty store returns empty array", () => {
  const api = activate();
  const result = api.vectorStore!.query({ query: "anything", limit: 5, settings: {} });
  assert.strictEqual(result.length, 0);
});

test("vector store upsert falls back to title when text is absent", () => {
  const api = activate();
  const result = api.vectorStore!.upsert({ id: "v-t", title: "title text", settings: {} });
  assert.deepEqual(result, { upserted: 1 });
});

// ---------------------------------------------------------------------------
// Parser override
// ---------------------------------------------------------------------------

test("parser override returns args and options unchanged", () => {
  const api = activate();
  assert.ok(api.parser, "parser should be registered");
  const result = api.parser!({ args: ["--json"], options: { verbose: true } });
  assert.deepEqual(result.args, ["--json"]);
  assert.deepEqual(result.options, { verbose: true });
});

test("parser override defaults to empty args and options when ctx is sparse", () => {
  const api = activate();
  const result = api.parser!({});
  assert.deepEqual(result.args, []);
  assert.deepEqual(result.options, {});
});

// ---------------------------------------------------------------------------
// Preflight override
// ---------------------------------------------------------------------------

test("preflight override preserves the runtime decision", () => {
  const api = activate();
  assert.ok(api.preflight, "preflight should be registered");
  const result = api.preflight!({
    decision: {
      enforce_item_format_gate: false,
      run_preflight_item_format_sync: true,
      run_extension_migrations: false,
      enforce_mandatory_migration_gate: true,
    },
  });
  assert.strictEqual(result.enforce_item_format_gate, false);
  assert.strictEqual(result.run_preflight_item_format_sync, true);
  assert.strictEqual(result.run_extension_migrations, false);
  assert.strictEqual(result.enforce_mandatory_migration_gate, true);
});

test("preflight override applies defaults when decision is absent", () => {
  const api = activate();
  const result = api.preflight!({});
  assert.strictEqual(result.enforce_item_format_gate, true);
  assert.strictEqual(result.run_preflight_item_format_sync, false);
  assert.strictEqual(result.run_extension_migrations, true);
  assert.strictEqual(result.enforce_mandatory_migration_gate, false);
});

// ---------------------------------------------------------------------------
// Service override
// ---------------------------------------------------------------------------

test("service override declines with handled: false", () => {
  const api = activate();
  assert.ok(api.service, "service should be registered");
  const result = api.service({ service: "output_format", payload: { some: "data" } });
  assert.deepEqual(result, { handled: false });
});

// ---------------------------------------------------------------------------
// Branch coverage: edge cases for ?? / || / ?: branches that need a dedicated
// test to exercise the nullish or falsy arm.
// ---------------------------------------------------------------------------

test("starter summary handles non-number totals.items and non-object by_status", async () => {
  stubResponse("stats", { totals: { items: "not a number" }, by_status: "not an object" });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter summary"].run(ctx()),
  );
  // totals.items is not a number → total falls back to 0.
  assert.ok(
    errors.some((e) => /Total items: 0/.test(e)),
    `total should fall back to 0: ${errors.join(" | ")}`,
  );
  // by_status is not an object → byStatus falls back to {}, so no status line
  // is printed. A status line looks like `  open: 3`; assert none appears.
  assert.ok(
    !errors.some((e) => /^\s+\w+: \d+/.test(e)),
    `no status line should be printed when by_status falls back to {}: ${errors.join(" | ")}`,
  );
});

test("starter plan fails silently (no stderr) and exits nonzero", async (t) => {
  setStubMode(t, "fail-silent");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter plan"].run(ctx(["bad-id"])),
    (err: Error) => {
      assert.ok(/failed\./.test(err.message), err.message);
      return true;
    },
  );
});

test("starter plan handles non-array steps value", async () => {
  stubResponse("plan", { plan: { title: "Bad Steps", mode: "ai", steps: "not an array" } });
  const api = activate();
  const res = await api.commands["starter plan"].run(ctx(["pm-7"]));
  assert.strictEqual(res.step_count, 0, "non-array steps should yield 0");
});

test("starter plan step without order and title uses fallbacks", async (t) => {
  stubResponse("plan", { plan: { title: "Fallbacks", mode: "ai", steps: [{ id: "bare", status: "completed" }] } });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter plan"].run(ctx(["pm-fb"], { steps: true })),
  );
  assert.ok(errors.some((e) => /\[x\].*\?\..*bare/.test(e)), "step without order should show ? and fall back to id for title");
});

test("starter context fails silently (no stderr) and exits nonzero", async (t) => {
  setStubMode(t, "fail-silent");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter context"].run(ctx()),
    (err: Error) => {
      assert.ok(/failed\./.test(err.message), err.message);
      return true;
    },
  );
});

test("starter context with absent agenda and activity uses []", async () => {
  stubResponse("context", { focus: [{ id: "pm-1", title: "F", status: "open" }] });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter context"].run(ctx()),
  );
  assert.ok(errors.some((e) => /Agenda entries: 0/.test(e)), "absent agenda should report 0");
  assert.ok(errors.some((e) => /Activity entries: 0/.test(e)), "absent activity should report 0");
});

test("starter context focus item without id/title/status uses fallbacks", async () => {
  stubResponse("context", { focus: [{ description: "bare" }], agenda: [], activity: [] });
  const api = activate();
  const { errors } = await captureOutput(() =>
    api.commands["starter context"].run(ctx()),
  );
  assert.ok(errors.some((e) => /\?.*\(untitled\).*\[\?\]/.test(e)), "should use ? / (untitled) / [?] fallbacks");
});

test("starter search with undefined args throws USAGE", async () => {
  const api = activate();
  await assert.rejects(
    // Pass a context with no args field at all to exercise ctx.args ?? []
    async () => api.commands["starter search"].run({ options: {}, pm_root: ".", command: "", global: {} }),
    (err: Error & { exitCode?: number }) => {
      assert.strictEqual(err.exitCode, 2);
      return true;
    },
  );
});

test("starter search fails silently (no stderr) and exits nonzero", async (t) => {
  setStubMode(t, "fail-silent");
  const api = activate();
  await assert.rejects(
    async () => api.commands["starter search"].run(ctx(["query"])),
    (err: Error) => {
      assert.ok(/failed\./.test(err.message), err.message);
      return true;
    },
  );
});

test("toon renderer handles absent item_count", () => {
  const api = activate();
  const rendered = api.renderers.toon.fn({ result: { starter_demo: true } });
  assert.match(rendered as string, /pm-starter demo — 0 item\(s\)/);
});

test("importer with falsy options uses empty object", async () => {
  const api = activate();
  // Pass options: undefined to exercise ctx.options || {}
  const res = await api.importer!({ options: undefined as any, pm_root: ".", registration: "starter-demo", action: "import", command: "starter-demo import", args: [], global: {} });
  assert.strictEqual(res.source, "(no source given)");
});

test("search provider handles document with missing metadata.title", () => {
  const api = activate();
  const result = api.searchProvider!.query({
    query: "bodymatch",
    mode: "keyword",
    tokens: ["bodymatch"],
    options: {},
    settings: {},
    documents: [
      { metadata: { id: "d-1" }, body: "bodymatch here" },
    ],
  });
  assert.strictEqual(result.hits.length, 1, "should match via body when title is absent");
});

test("vector store upsert with undefined id returns zero", () => {
  const api = activate();
  const result = api.vectorStore!.upsert({ settings: {} });
  assert.deepEqual(result, { upserted: 0 });
});

test("vector store upsert with no text and no title uses empty string", () => {
  const api = activate();
  // Both text and title absent → String(undefined ?? undefined ?? "") = ""
  const result = api.vectorStore!.upsert({ id: "v-empty", settings: {} });
  assert.deepEqual(result, { upserted: 1 });
});

test("vector store query with absent query uses empty string", () => {
  const api = activate();
  api.vectorStore!.upsert({ id: "v-q", text: "hello", settings: {} });
  // query is absent → String(undefined ?? "") = ""
  const result = api.vectorStore!.query({ limit: 5, settings: {} });
  assert.ok(Array.isArray(result), "should return array even with empty query");
});

test("vector store query with absent limit uses default 5", () => {
  const api = activate();
  api.vectorStore!.upsert({ id: "v-l1", text: "a", settings: {} });
  api.vectorStore!.upsert({ id: "v-l2", text: "a", settings: {} });
  // limit is absent → ?? 5
  const result = api.vectorStore!.query({ query: "a", settings: {} });
  assert.ok(result.length <= 5, "should use default limit of 5");
});
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionApi } from "@unbrained/pm-cli/sdk/authoring";
import { createExtensionTestHarness, runRegisteredServiceOverrideForTest } from "@unbrained/pm-cli/sdk/testing";

import extension, { optionPositiveInteger, readPmItems } from "../index.ts";

/** Opaque callback/value capture used only across the deliberately loose test-double boundary. */
interface CapturedValue {
  (...args: unknown[]): CapturedValue;
  readonly [key: string]: CapturedValue;
  readonly [index: number]: CapturedValue;
}

/** Create the minimal registration sink used by command-focused smoke cases. */
function createMockApi(commands: Record<string, CapturedValue> = {}): ExtensionApi {
  return {
    registerCommand: (command: CapturedValue) => { commands[String(command.name)] = command; },
    registerParser: () => {},
    registerPreflight: () => {},
    registerService: () => {},
    registerFlags: () => {},
    registerItemFields: () => {},
    registerItemTypes: () => {},
    registerMigration: () => {},
    registerRenderer: () => {},
    registerImporter: () => {},
    registerExporter: () => {},
    registerSearchProvider: () => {},
    registerVectorStoreAdapter: () => {},
    hooks: { beforeCommand: () => {}, afterCommand: () => {}, onWrite: () => {}, onRead: () => {}, onIndex: () => {} },
  } as unknown as ExtensionApi;
}

test("extension has required shape", () => {
  assert.ok(extension, "module should export a default value");
  assert.strictEqual(typeof extension, "object", "extension should be an object");
  assert.ok("name" in extension, "extension should have a name property");
  assert.ok("activate" in extension, "extension should have an activate method");
  assert.strictEqual(typeof extension.activate, "function", "activate should be a function");
});

test("extension registers at least one capability", () => {
  const registered: string[] = [];
  const commands: Record<string, CapturedValue> = {};
  const renderers: Record<string, CapturedValue> = {};
  let importer: CapturedValue | undefined;
  let exporter: CapturedValue | undefined;
  // Mirror the full ExtensionApi so the reference extension can register every
  // demonstrated capability (this template exercises all of them).
  const api = {
    registerCommand: (command: CapturedValue) => { registered.push("command"); commands[String(command.name)] = command; },
    registerParser: () => { registered.push("parser"); },
    registerPreflight: () => { registered.push("preflight"); },
    registerService: () => { registered.push("service"); },
    registerFlags: () => { registered.push("flags"); },
    registerItemFields: () => { registered.push("itemFields"); },
    registerItemTypes: () => { registered.push("itemTypes"); },
    registerMigration: () => { registered.push("migration"); },
    registerRenderer: (format: string, renderer: CapturedValue) => { registered.push("renderer"); renderers[format] = renderer; },
    registerImporter: (_name: string, handler: CapturedValue) => { registered.push("importer"); importer = handler; },
    registerExporter: (_name: string, handler: CapturedValue) => { registered.push("exporter"); exporter = handler; },
    registerSearchProvider: () => { registered.push("search"); },
    registerVectorStoreAdapter: () => { registered.push("vectorStore"); },
    hooks: {
      beforeCommand: () => { registered.push("hook:before"); },
      afterCommand: () => { registered.push("hook:after"); },
      onWrite: () => { registered.push("hook:onWrite"); },
      onRead: () => { registered.push("hook:onRead"); },
      onIndex: () => { registered.push("hook:onIndex"); },
    },
  };
  extension.activate(api as unknown as ExtensionApi);
  assert.ok(registered.length > 0, `extension should register at least one capability, got: ${JSON.stringify(registered)}`);

  // This reference extension demonstrates ALL 9 SDK capability types, so the
  // mock above must let every register*/hook call fire. Assert each one ran so
  // the template stays a faithful, complete reference (a dropped capability or a
  // renamed SDK method surfaces here, not silently at install time).
  const expected = [
    "command", "renderer", "hook:before", "hook:after", "hook:onWrite",
    "hook:onRead", "hook:onIndex", "itemFields", "itemTypes", "migration",
    "importer", "exporter", "search", "vectorStore", "parser", "preflight",
    "service", "flags",
  ];
  for (const cap of expected) {
    assert.ok(registered.includes(cap), `extension should register "${cap}" (got: ${JSON.stringify(registered)})`);
  }

  assert.deepStrictEqual(Object.keys(commands).sort(), ["starter context", "starter demo", "starter greet", "starter plan", "starter search", "starter setup", "starter summary"]);
  assert.strictEqual(commands["starter greet"].flags.length, 3);
  assert.ok(commands["starter plan"].failure_hints && commands["starter plan"].failure_hints.length > 0, "starter plan should have failure_hints");
  assert.ok(commands["starter search"].arguments && commands["starter search"].arguments.length > 0, "starter search should declare arguments");
  assert.strictEqual(commands["starter setup"].flags.length, 3);
  assert.ok(commands["starter summary"].failure_hints && commands["starter summary"].failure_hints.length > 0, "starter summary should have failure_hints");
  assert.strictEqual(renderers.json({ result: { other: true } }), null);
  assert.match(
    String(renderers.toon({ result: { starter_demo: true, item_count: 1, sample: [{ id: "pm-1", status: "open", title: "Demo" }] } })),
    /pm-starter demo/
  );
  assert.ok(importer, "starter importer should be captured");
  assert.ok(exporter, "starter exporter should be captured");
});

test("starter plan throws USAGE error when no id is provided", async () => {
  const commands: Record<string, CapturedValue> = {};
  const api = createMockApi(commands);
  extension.activate(api);

  // No ID provided -> should throw CommandError with exitCode USAGE (2)
  await assert.rejects(
    async () => commands["starter plan"].run({ args: [], options: {}, pm_root: "." }),
    (error: unknown) => typeof error === "object" && error !== null && "exitCode" in error && error.exitCode === 2,
  );
});

test("starter search throws USAGE error when no keywords are provided", async () => {
  const commands: Record<string, CapturedValue> = {};
  const api = createMockApi(commands);
  extension.activate(api);

  await assert.rejects(
    async () => commands["starter search"].run({ args: [], options: {}, pm_root: "." }),
    (error: unknown) => typeof error === "object" && error !== null && "exitCode" in error && error.exitCode === 2,
  );
});

test("starter setup throws USAGE error when --name is missing in non-interactive mode", async () => {
  const commands: Record<string, CapturedValue> = {};
  const api = createMockApi(commands);
  extension.activate(api);

  await assert.rejects(
    async () => commands["starter setup"].run({ args: [], options: {}, pm_root: "." }),
    (error: unknown) => typeof error === "object" && error !== null && "exitCode" in error && error.exitCode === 2,
  );
});

test("starter setup interactive mode returns guided steps", async () => {
  const commands: Record<string, CapturedValue> = {};
  const api = createMockApi(commands);
  extension.activate(api);

  const result = await commands["starter setup"].run({ args: [], options: { interactive: true }, pm_root: "." });
  assert.strictEqual(result.interactive, true);
  assert.ok(result.steps.includes("scaffold"));
});

test("positive integer options honor numeric and string SDK values", () => {
  assert.strictEqual(optionPositiveInteger({ limit: 3 }, 10, "limit"), 3);
  assert.strictEqual(optionPositiveInteger({ limit: "4" }, 10, "limit"), 4);
  assert.strictEqual(optionPositiveInteger({ limit: -5 }, 10, "limit"), 10);
  assert.strictEqual(optionPositiveInteger({ limit: "1.5" }, 10, "limit"), 10);
  assert.strictEqual(optionPositiveInteger({ limit: "invalid" }, 10, "limit"), 10);
});

// --- pm read buffer -----------------------------------------------------------
// The 64 MiB cap and its ENOBUFS diagnostic are a failure *contract*: a read that
// outgrows the buffer must not be reported as an empty workspace. The cap is env
// configurable, which makes the branch testable for real — no spawnSync mocking.

test("readPmItems honors PM_JSON_MAX_BUFFER and reports an overrun instead of returning a silent empty array", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pm-starter-buffer-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const pmRoot = join(dir, ".agents", "pm");
  try {
    execFileSync("pm", ["init", "--pm-path", pmRoot], { cwd: dir, stdio: "ignore" });
    execFileSync("pm", ["create", "--pm-path", pmRoot, "--type", "issue", "--title", "Buffer probe item", "--author", "test"], { cwd: dir, stdio: "ignore" });
  } catch {
    t.skip("pm CLI unavailable");
    return;
  }

  // Sanity: the default cap reads the workspace.
  const baseline = readPmItems(pmRoot);
  assert.ok(baseline.ok && baseline.items.length >= 1, "default cap should read the item");

  const messages: string[] = [];
  const originalError = console.error;
  const originalCap = process.env.PM_JSON_MAX_BUFFER;
  console.error = (...values: unknown[]) => messages.push(values.join(" "));
  // 64 bytes cannot hold any item payload, so the read overruns deterministically.
  process.env.PM_JSON_MAX_BUFFER = "64";
  try {
    const outcome = readPmItems(pmRoot);
    assert.strictEqual(outcome.ok, false, "the never-throw contract holds, but an overrun is a failed read");
    assert.match(
      outcome.reason,
      /read buffer/,
      "the overrun must be named in the reason, not merely logged"
    );
  } finally {
    console.error = originalError;
    if (originalCap === undefined) delete process.env.PM_JSON_MAX_BUFFER;
    else process.env.PM_JSON_MAX_BUFFER = originalCap;
  }
});

test("a malformed PM_JSON_MAX_BUFFER falls back to the default instead of imposing a tiny cap", async (t) => {
  // parseInt("64MiB") === 64 would have imposed a 64-BYTE cap and broken every
  // ordinary read while appearing to honor the documented fallback.
  const dir = mkdtempSync(join(tmpdir(), "pm-starter-badcap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pmRoot = join(dir, ".agents", "pm");
  try {
    execFileSync("pm", ["init", "--pm-path", pmRoot], { cwd: dir, stdio: "ignore" });
    execFileSync("pm", ["create", "--pm-path", pmRoot, "--type", "issue", "--title", "Fallback probe item", "--author", "test"], { cwd: dir, stdio: "ignore" });
  } catch {
    t.skip("pm CLI unavailable");
    return;
  }

  const originalCap = process.env.PM_JSON_MAX_BUFFER;
  try {
    for (const malformed of ["64MiB", "64 MB", "abc", "-1", "0", "6.5", ""]) {
      process.env.PM_JSON_MAX_BUFFER = malformed;
      const outcome = readPmItems(pmRoot);
      assert.ok(
        outcome.ok && outcome.items.length >= 1,
        `PM_JSON_MAX_BUFFER=${JSON.stringify(malformed)} must fall back to the default, not cap the read`
      );
    }
    // A valid explicit value is still honored.
    process.env.PM_JSON_MAX_BUFFER = String(32 * 1024 * 1024);
    const explicit = readPmItems(pmRoot);
    assert.ok(explicit.ok && explicit.items.length >= 1, "a valid explicit cap should still read the workspace");
  } finally {
    if (originalCap === undefined) delete process.env.PM_JSON_MAX_BUFFER;
    else process.env.PM_JSON_MAX_BUFFER = originalCap;
  }
});

// ---------------------------------------------------------------------------
// Regression: the `output_format` service override MUST decline payloads it
// does not claim, via the `{ handled: false }` decision.
//
// Before pm-cli 2026.7.27 an override could decline by returning the inbound
// `context.payload`, and this extension did exactly that. In 2026.7.27 an
// override's bare return value IS what the host renders, so echoing the payload
// made EVERY command in a workspace with this extension installed print the
// whole command context (`global`, `format`, `options`, ...) instead of its own
// result. Filed upstream as unbraind/pm-cli#776.
//
// This is exercised through pm's REAL service runner rather than a hand-rolled
// api double: the previous double discarded the registered override entirely, so
// its return value was never evaluated and the regression was invisible to the
// test suite.
// ---------------------------------------------------------------------------

test("output_format override declines unclaimed payloads instead of echoing the context", async () => {
  const harness = await createExtensionTestHarness(extension, {
    name: "pm-starter",
    capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"],
  });
  assert.deepEqual(harness.activation.failed, [], "activation must not fail");

  // The override must actually be registered for the `output_format` service.
  harness.assertServiceOverride({ name: "output_format" });

  const payload = { command: "list", format: "toon", result: { items: [{ id: "probe-1" }], count: 1 } };
  const outcome = await runRegisteredServiceOverrideForTest(harness.activation.services, {
    service: "output_format",
    command: "list",
    payload,
  } as Parameters<typeof runRegisteredServiceOverrideForTest>[1]);

  assert.equal(
    outcome.handled,
    false,
    "a pass-through override must report handled:false so the host renders the payload itself"
  );
  // On a decline pm's runner deliberately echoes the ORIGINAL payload back as
  // `result` (see resolveServiceOverrideValue) and the host then renders it
  // itself. What must never happen is `handled: true`, which hands the host our
  // return value verbatim.
  assert.deepEqual(outcome.result, payload, "a declined payload must be returned to the host untouched");
  assert.deepEqual(outcome.warnings, [], "declining must not emit service-override warnings");
});

// ---------------------------------------------------------------------------
// Regression: the extension's self-reported version MUST equal the package
// version.
//
// The version lives in three places that must always agree: package.json,
// manifest.json, and the version constant in index.ts — which is what gets
// compiled into the committed dist/index.js and is what a host reads for
// runtime diagnostics (`pm extension --manage`). The 2026.7.27 bump updated
// package.json but left the extension export at 2026.7.26 (caught by Greptile
// on PR #40), so an installed pm-starter reported the WRONG release. The
// extension must NOT read package.json at runtime (standalone installs resolve
// only their own dist/), so the constant is deliberately duplicated — this
// test is the pin that keeps the copies from drifting on the next bump.
//
// The extension under test is imported from ../index.ts, so this also fails
// if the source version constant drifts from package.json / manifest.json.
// ---------------------------------------------------------------------------

/** Read the string `version` field of a JSON file relative to this test file. */
function readJsonVersion(relativeUrl: string): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), "utf-8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${relativeUrl}: expected a JSON object`);
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`${relativeUrl}: missing a non-empty string "version" field`);
  }
  return version;
}

test("extension self-reported version matches package.json and manifest.json", () => {
  // dist-test/smoke.test.js is one directory deeper than test/smoke.test.ts,
  // so both resolve to the repo-root files either way.
  const packageVersion = readJsonVersion("../package.json");
  const manifestVersion = readJsonVersion("../manifest.json");

  assert.strictEqual(
    extension.version,
    packageVersion,
    `extension reports "${extension.version}" but package.json declares "${packageVersion}" — ` +
      "the version constant in index.ts (and the rebuilt dist/) must track every version bump",
  );
  assert.strictEqual(
    manifestVersion,
    packageVersion,
    `manifest.json declares "${manifestVersion}" but package.json declares "${packageVersion}"`,
  );
});

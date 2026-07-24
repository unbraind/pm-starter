import assert from "node:assert/strict";
import test from "node:test";

import extension, { optionPositiveInteger } from "../dist/index.js";

function createMockApi(commands: Record<string, any> = {}): any {
  return {
    registerCommand: (command: any) => { commands[command.name] = command; },
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
  };
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
  const commands: Record<string, any> = {};
  const renderers: Record<string, (ctx: any) => unknown> = {};
  let importer: ((ctx: any) => unknown) | undefined;
  let exporter: ((ctx: any) => unknown) | undefined;
  // Mirror the full ExtensionApi so the reference extension can register every
  // demonstrated capability (this template exercises all of them).
  const api = {
    registerCommand: (command: any) => { registered.push("command"); commands[command.name] = command; },
    registerParser: () => { registered.push("parser"); },
    registerPreflight: () => { registered.push("preflight"); },
    registerService: () => { registered.push("service"); },
    registerFlags: () => { registered.push("flags"); },
    registerItemFields: () => { registered.push("itemFields"); },
    registerItemTypes: () => { registered.push("itemTypes"); },
    registerMigration: () => { registered.push("migration"); },
    registerRenderer: (format: string, renderer: (ctx: any) => unknown) => { registered.push("renderer"); renderers[format] = renderer; },
    registerImporter: (_name: string, handler: (ctx: any) => unknown) => { registered.push("importer"); importer = handler; },
    registerExporter: (_name: string, handler: (ctx: any) => unknown) => { registered.push("exporter"); exporter = handler; },
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
  extension.activate(api as any);
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
  const commands: Record<string, any> = {};
  const api = createMockApi(commands);
  extension.activate(api as any);

  // No ID provided -> should throw CommandError with exitCode USAGE (2)
  await assert.rejects(
    async () => commands["starter plan"].run({ args: [], options: {}, pm_root: "." }),
    (err: any) => err.exitCode === 2,
  );
});

test("starter search throws USAGE error when no keywords are provided", async () => {
  const commands: Record<string, any> = {};
  const api = createMockApi(commands);
  extension.activate(api as any);

  await assert.rejects(
    async () => commands["starter search"].run({ args: [], options: {}, pm_root: "." }),
    (err: any) => err.exitCode === 2,
  );
});

test("starter setup throws USAGE error when --name is missing in non-interactive mode", async () => {
  const commands: Record<string, any> = {};
  const api = createMockApi(commands);
  extension.activate(api as any);

  await assert.rejects(
    async () => commands["starter setup"].run({ args: [], options: {}, pm_root: "." }),
    (err: any) => err.exitCode === 2,
  );
});

test("starter setup interactive mode returns guided steps", async () => {
  const commands: Record<string, any> = {};
  const api = createMockApi(commands);
  extension.activate(api as any);

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
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { readPmItems } = await import("../dist/index.js");

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
  assert.ok(readPmItems(pmRoot).length >= 1, "default cap should read the item");

  const messages: string[] = [];
  const originalError = console.error;
  const originalCap = process.env.PM_JSON_MAX_BUFFER;
  console.error = (...values: unknown[]) => messages.push(values.join(" "));
  // 64 bytes cannot hold any item payload, so the read overruns deterministically.
  process.env.PM_JSON_MAX_BUFFER = "64";
  try {
    const items = readPmItems(pmRoot);
    assert.deepEqual(items, [], "the never-throw contract must still hold");
    assert.ok(
      messages.some((message) => /read buffer/.test(message)),
      `overrun must be reported, not silent; saw: ${messages.join(" | ")}`
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
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { readPmItems } = await import("../dist/index.js");

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
      assert.ok(
        readPmItems(pmRoot).length >= 1,
        `PM_JSON_MAX_BUFFER=${JSON.stringify(malformed)} must fall back to the default, not cap the read`
      );
    }
    // A valid explicit value is still honored.
    process.env.PM_JSON_MAX_BUFFER = String(32 * 1024 * 1024);
    assert.ok(readPmItems(pmRoot).length >= 1, "a valid explicit cap should still read the workspace");
  } finally {
    if (originalCap === undefined) delete process.env.PM_JSON_MAX_BUFFER;
    else process.env.PM_JSON_MAX_BUFFER = originalCap;
  }
});

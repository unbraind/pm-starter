import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { PmClient, createExtensionCommandSdk, locateItem, readLocatedItem } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";

import extension, { optionPositiveInteger, readPmItems } from "../index.ts";
import type { LaboratoryRun, LaboratoryCommandRefusal } from "../laboratories.ts";

/** Activate the shipped manifest and bind invocations to an initialized, non-git tracker. */
async function smokeTracker(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "pm-starter-smoke-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const pmRoot = join(directory, ".agents", "pm");
  const client = new PmClient({ pmRoot, noExtensions: true, author: "smoke-test" });
  await client.init("smoke", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  const manifest: unknown = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const harness = await createExtensionTestHarness({ default: extension, manifest });
  t.after(() => harness.deactivate());
  return { harness, pmRoot, client };
}

test("extension has required shape", () => {
  assert.ok(extension, "module should export a default value");
  assert.strictEqual(typeof extension, "object", "extension should be an object");
  assert.ok("name" in extension, "extension should have a name property");
  assert.ok("activate" in extension, "extension should have an activate method");
  assert.strictEqual(typeof extension.activate, "function", "activate should be a function");
});

test("extension registers every demonstrated capability through the SDK host", async (t) => {
  const { harness } = await smokeTracker(t);
  harness.assertCapabilityUsage({ declared: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  assert.deepEqual(harness.activation.registrations.commands.map((command) => command.command).sort(), [
    "starter baseline", "starter consume", "starter context", "starter demo", "starter greet", "starter lab", "starter plan", "starter recover", "starter search", "starter setup", "starter summary", "starter-demo export", "starter-demo import", "starter-lab export",
  ]);
  assert.equal(harness.assertCommandContract({ name: "starter greet", flags: ["--name", "--emoji", "--uppercase"] }).flags.length, 3);
  assert.ok(harness.assertCommandContract({ name: "starter plan" }).command.failure_hints.length > 0);
  assert.ok(harness.assertCommandContract({ name: "starter search" }).command.arguments.length > 0);
  assert.equal(harness.assertCommandContract({ name: "starter setup" }).flags.length, 3);
  assert.ok(harness.assertCommandContract({ name: "starter summary" }).command.failure_hints.length > 0);
  harness.assertFlags({ name: "list", flags: ["--starter-tag"] });
  harness.assertItemField({ name: "starter_origin", type: "string" });
  harness.assertItemField({ name: "starter_score", type: "number" });
  harness.assertItemType({ name: "StarterNote", folder: "starter-notes" });
  harness.assertMigration({ name: "pm-starter-0001-noop", mandatory: false });
  for (const kind of ["before_command", "after_command", "on_write", "on_read", "on_index"] as const) {
    harness.assertHook({ kind });
  }
  harness.assertParserOverride({ name: "list" });
  harness.assertPreflightOverride();
  harness.assertServiceOverride({ name: "output_format" });
  harness.assertSearchProvider({ name: "starter-substring" });
  harness.assertVectorStoreAdapter({ name: "starter-memory" });
  harness.assertImporter({ name: "starter-demo" });
  harness.assertExporter({ name: "starter-demo" });
  harness.assertExporter({ name: "starter-lab" });
  for (const format of ["json", "toon"] as const) harness.assertRendererOverride({ name: format });
});

test("registered renderers retain ownership and output receipts", async (t) => {
  const { harness, pmRoot, client } = await smokeTracker(t);
  await client.create({ id: "sample", type: "Task", title: "Demo" });
  const outcome = await harness.runCommand({ command: "starter demo", pmRoot });
  assert.equal(outcome.handled, true);
  assert.deepEqual(outcome.warnings, []);
  const rendered = await harness.runRendererOverride({ format: "toon", command: "starter demo", result: outcome.result, pm_root: pmRoot });
  assert.equal(rendered.overridden, true);
  assert.match(rendered.rendered ?? "", /pm-starter demo.*1 item/);
  assert.match(rendered.rendered ?? "", /Demo/);
  assert.deepEqual(rendered.warnings, []);
  const unrelated = await harness.runRendererOverride({ format: "json", command: "list", result: outcome.result, pm_root: pmRoot });
  assert.deepEqual(unrelated, { overridden: false, rendered: null, warnings: [] });
  const wrongPayload = await harness.runRendererOverride({ format: "json", command: "starter demo", result: { other: true }, pm_root: pmRoot });
  assert.deepEqual(wrongPayload, { overridden: false, rendered: null, warnings: [] });
});

test("starter plan throws USAGE error when no id is provided", async (t) => {
  const { harness, pmRoot } = await smokeTracker(t);
  await assert.rejects(
    () => harness.runCommand({ command: "starter plan", pmRoot }),
    (error: unknown) => typeof error === "object" && error !== null && "exitCode" in error && error.exitCode === 2,
  );
});

test("starter search throws USAGE error when no keywords are provided", async (t) => {
  const { harness, pmRoot } = await smokeTracker(t);
  await assert.rejects(
    () => harness.runCommand({ command: "starter search", pmRoot }),
    (error: unknown) => typeof error === "object" && error !== null && "exitCode" in error && error.exitCode === 2,
  );
});

test("starter setup throws USAGE error when --name is missing in non-interactive mode", async (t) => {
  const { harness, pmRoot } = await smokeTracker(t);
  await assert.rejects(
    () => harness.runCommand({ command: "starter setup", pmRoot }),
    (error: unknown) => typeof error === "object" && error !== null && "exitCode" in error && error.exitCode === 2,
  );
});

test("starter setup interactive mode returns guided steps", async (t) => {
  const { harness, pmRoot } = await smokeTracker(t);
  const outcome = await harness.runCommand({ command: "starter setup", options: { interactive: true }, pmRoot });
  assert.equal(outcome.handled, true);
  assert.deepEqual(outcome.warnings, []);
  assert.deepEqual(outcome.result, { interactive: true, steps: ["name", "capability", "scaffold", "verify"] });
});

test("SDK-bound laboratory returns certified receipts and refuses mutation without writes", async (t) => {
  const { harness, pmRoot, client } = await smokeTracker(t);
  await client.create({ id: "receipt", type: "Task", title: "Receipt" });
  const before = await client.get("receipt");
  const outcome = await harness.runCommand({ command: "starter lab", options: { capability: "commands" }, pmRoot });
  assert.equal(outcome.handled, true);
  assert.deepEqual(outcome.warnings, []);
  const receipt = outcome.result as LaboratoryRun;
  assert.equal(receipt.identical, true);
  assert.deepEqual(receipt.directory, { ok: true, schema: "pm-starter/laboratory/v1", capability: "commands", operation: "read", item_count: 1, evidence: { open: 1 } });
  assert.deepEqual(receipt.directory, receipt.synthetic_remote);
  const denied = await harness.runCommand({ command: "starter lab", options: { operation: "mutate" }, pmRoot });
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.errorCode, "laboratory_refused");
  assert.equal((denied.result as LaboratoryCommandRefusal).receipt?.directory_refusal.ok, false);
  assert.deepEqual(await client.get("receipt"), before);
});

test("registered write hook observes a real mutation context without changing its item", async (t) => {
  const { harness, pmRoot, client } = await smokeTracker(t);
  const created = await client.create({ id: "write-context", type: "Task", title: "Before" });
  const located = await locateItem(pmRoot, created.item.id);
  assert.ok(located);
  const before = (await readLocatedItem(located)).document;
  const updated = await client.update("write-context", { title: "After" });
  const after = (await readLocatedItem(located)).document;
  const item = await client.get("write-context");
  assert.equal(item.item.title, "After");
  const savedHooks = process.env.PM_STARTER_HOOKS;
  process.env.PM_STARTER_HOOKS = "1";
  t.after(() => {
    if (savedHooks === undefined) delete process.env.PM_STARTER_HOOKS;
    else process.env.PM_STARTER_HOOKS = savedHooks;
  });
  const log = t.mock.method(console, "error", () => {});
  // The harness dispatches this hook explicitly; it does not auto-install the extension on the client.
  const warnings = await harness.runHook({ kind: "on_write", context: {
    path: located.itemPath, scope: "project", op: "update", item_id: item.item.id,
    item_type: item.item.type, before, after, changed_fields: updated.changed_fields,
  } });
  assert.deepEqual(warnings, []);
  assert.deepEqual(log.mock.calls.map((call) => call.arguments), [[`[pm-starter] onWrite: update project ${located.itemPath}`]]);
  assert.deepEqual(await client.get("write-context"), item);
});

test("positive integer options honor numeric and string SDK values", () => {
  assert.strictEqual(optionPositiveInteger({ limit: 3 }, 10, "limit"), 3);
  assert.strictEqual(optionPositiveInteger({ limit: "4" }, 10, "limit"), 4);
  assert.strictEqual(optionPositiveInteger({ limit: -5 }, 10, "limit"), 10);
  assert.strictEqual(optionPositiveInteger({ limit: "1.5" }, 10, "limit"), 10);
  assert.strictEqual(optionPositiveInteger({ limit: "invalid" }, 10, "limit"), 10);
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

test("output_format override declines unclaimed payloads instead of echoing the context", async (t) => {
  const { harness, pmRoot } = await smokeTracker(t);
  harness.assertServiceOverride({ name: "output_format" });

  const payload = { command: "list", format: "toon", result: { items: [{ id: "probe-1" }], count: 1 } };
  const outcome = await harness.runServiceOverride({
    service: "output_format",
    command: "list",
    payload,
    global: {}, pm_root: pmRoot,
  });

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


test("readPmItems returns the complete large tracker beyond the default output budget", async (t) => {
  const { pmRoot, client } = await smokeTracker(t);
  const body = "Complete corpus regression text. ".repeat(400).trim();
  for (let index = 0; index < 6; index++) {
    await client.create({ type: "Issue", title: `Budget probe ${index}`, body, author: "test" });
  }
  const outcome = await readPmItems({ sdk: createExtensionCommandSdk(pmRoot, client) });
  assert.ok(outcome.ok, outcome.ok ? "complete read" : outcome.reason);
  assert.equal(outcome.items.length, 6);
  assert.ok(outcome.items.every((item) => item.body === body));
});

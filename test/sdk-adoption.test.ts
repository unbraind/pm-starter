import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { PmClient, createExtensionCommandSdk, readHistoryAnalyticsWindow } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension, { CommandError, readPmItems } from "../index.ts";

/** Hash durable tracker state while allowing SDK-owned derived caches. */
function fingerprint(root: string): string {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .filter((entry) => !["runtime", "locks", "search", "extensions"].includes(entry.name))
    .map((entry) => `${entry.name}:${entry.isDirectory() ? fingerprint(join(root, entry.name))
      : createHash("sha256").update(readFileSync(join(root, entry.name))).digest("hex")}`).join("\n");
}

/** Initialize a real tracker outside git and remove it after its test. */
async function tracker(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "starter-sdk-"));
  const savedPath = process.env.PATH;
  const savedCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = dirname(directory);
  t.after(() => {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    if (savedCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
    rmSync(directory, { recursive: true, force: true });
  });
  const pmRoot = join(directory, ".agents/pm");
  const client = new PmClient({ pmRoot, noExtensions: true, author: "sdk-test" });
  await client.init("sdk-test", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  process.env.PATH = directory; // No pm or git executable: reads must use the host SDK.
  return { directory, pmRoot, client, sdk: createExtensionCommandSdk(pmRoot, client) };
}

/** Activate the real SDK command/exporter dispatcher. */
function harness() {
  return createExtensionTestHarness(extension, { capabilities: [
    "commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services",
  ] });
}

test("host SDK reads complete full bodies and terminal items without pm or git, leaving durable state unchanged", async (t) => {
  const { client, sdk, pmRoot } = await tracker(t);
  const first = await client.create({ title: "First", type: "Task", body: "Full body" });
  await client.create({ title: "Closed", type: "Task", status: "closed", closeReason: "Test terminal inclusion" });
  await client.create({ title: "Canceled", type: "Task", status: "canceled", closeReason: "Test terminal inclusion" });
  const before = fingerprint(pmRoot);
  const ext = await harness();
  const demo = await ext.runCommand({ command: "starter demo", pmRoot, sdk });
  assert.equal(demo.exitCode, undefined);
  const rows = await readPmItems({ sdk });
  assert.ok(rows.ok);
  assert.equal(rows.items.length, 3);
  assert.equal(rows.items.find((item) => item.id === first.item.id)?.body, "Full body");
  assert.deepEqual(demo.result, { starter_demo: true, item_count: 3,
    sample: rows.items.map(({ id, title, status }) => ({ id, title, status })) });
  const savedLog = console.log;
  const output: string[] = [];
  console.log = (value: unknown) => { output.push(String(value)); };
  try {
    const exported = await ext.runExporter({ exporter: "starter-demo", pmRoot });
    assert.equal(exported.exitCode, undefined);
    assert.deepEqual(exported.result, { exported: 3, format: "json" });
    assert.deepEqual(JSON.parse(output.join("\n")), rows.items.map(({ id, title, type, status }) => ({ id, title, type, status })));
  } finally { console.log = savedLog; }
  assert.equal(fingerprint(pmRoot), before);
});

test("missing SDK and failed real SDK reads remain explicit failures, including both callers", async (t) => {
  assert.match((await readPmItems({})).ok ? "" : JSON.stringify(await readPmItems({})), /ctx.sdk/);
  const { directory, sdk: initializedSdk } = await tracker(t);
  assert.deepEqual(await readPmItems({ sdk: initializedSdk }), { ok: true, items: [] });
  const pmRoot = join(directory, "uninitialized");
  const sdk = createExtensionCommandSdk(pmRoot, new PmClient({ pmRoot, noExtensions: true }));
  const failed = await readPmItems({ sdk });
  assert.equal(failed.ok, false);
  const ext = await harness();
  await assert.rejects(ext.runCommand({ command: "starter demo", pmRoot, sdk }), CommandError);
  await assert.rejects(ext.runExporter({ exporter: "starter-demo", pmRoot }), CommandError);
});

test("fresh verified history refuses corruption after SDK event-index and complete-list caches are primed", async (t) => {
  const { client, sdk, pmRoot } = await tracker(t);
  const { item } = await client.create({ title: "Integrity probe", type: "Task" });
  assert.ok((await readPmItems({ sdk })).ok);
  const cache = await readHistoryAnalyticsWindow(pmRoot, { since: "2000-01-01T00:00:00.000Z" });
  assert.equal(cache.receipt.source, "history_event_index");
  assert.ok(cache.events.some((event) => event.item_id === item.id));
  const historyPath = join(pmRoot, "history", `${item.id}.jsonl`);
  const original = readFileSync(historyPath, "utf8");
  const record: Record<string, unknown> = JSON.parse(original.trim());
  record.record_hash = "0".repeat(64);
  const corrupt = `${JSON.stringify(record)}\n`;
  assert.equal(corrupt.length, original.length, "same-size corruption defeats size-only cache checks");
  writeFileSync(historyPath, corrupt);
  const result = await readPmItems({ sdk });
  assert.deepEqual(result, { ok: false, reason: `history integrity verification failed for ${item.id}` });
  const ext = await harness();
  await assert.rejects(ext.runCommand({ command: "starter demo", pmRoot, sdk }), /history integrity/);
  await assert.rejects(ext.runExporter({ exporter: "starter-demo", pmRoot }), /history integrity/);
  assert.equal(readFileSync(historyPath, "utf8"), corrupt, "failed read never repairs history");
});

test("SDK completeness refuses an unreadable item rather than returning a shortened workspace", async (t) => {
  const { client, sdk, pmRoot } = await tracker(t);
  const { item } = await client.create({ title: "Unreadable probe", type: "Task" });
  assert.ok((await readPmItems({ sdk })).ok);
  writeFileSync(join(pmRoot, "tasks", `${item.id}.toon`), "invalid tracker item");
  const result = await readPmItems({ sdk });
  assert.equal(result.ok, false);
  const ext = await harness();
  await assert.rejects(ext.runCommand({ command: "starter demo", pmRoot, sdk }), CommandError);
  await assert.rejects(ext.runExporter({ exporter: "starter-demo", pmRoot }), CommandError);
});

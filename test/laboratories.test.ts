import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import {
  createDirectoryLaboratoryAdapter, createSyntheticRemoteLaboratoryAdapter, executeCapabilityLaboratory, runExportLaboratory,
  runCapabilityLaboratory, runLaboratoryCommand,
} from "../laboratories.ts";

/** Fingerprint durable files, including item bodies and append-only history. */
function durableFiles(root: string): string {
  const hashes: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (["runtime", "locks", "search", "extensions"].includes(entry.name)) continue;
    const path = join(root, entry.name);
    hashes.push(`${entry.name}:${entry.isDirectory() ? durableFiles(path) : createHash("sha256").update(readFileSync(path)).digest("hex")}`);
  }
  return hashes.join("\n");
}

test("both executable capabilities keep certified backend receipts identical without Git", async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "starter-labs-"));
  const oldCeiling = process.env.GIT_CEILING_DIRECTORIES;
  const oldPath = process.env.PATH;
  t.after(() => {
    if (oldCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = oldCeiling;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(scratch, { recursive: true, force: true });
  });
  process.env.GIT_CEILING_DIRECTORIES = dirname(scratch);
  const pmRoot = join(scratch, ".agents/pm");
  const client = new PmClient({ pmRoot, noExtensions: true, author: "lab-test" });
  await client.init("lab", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  await client.create({ title: "First", type: "Task" });
  await client.create({ title: "Second", type: "Task" });
  await client.create({ title: "Third", type: "Feature", status: "closed", closeReason: "Terminal read coverage" });
  // Empty PATH is a stronger no-Git check than a fake git executable.
  process.env.PATH = scratch;
  const before = durableFiles(pmRoot);
  for (const capability of ["commands", "importers"] as const) {
    const result = await runCapabilityLaboratory(client, capability);
    assert.equal(result.identical, true);
    assert.deepEqual(result.directory, result.synthetic_remote);
    assert.deepEqual(result.directory_refusal, result.synthetic_remote_refusal);
    assert.equal(result.directory_refusal.ok, false);
    assert.ok(!result.directory_refusal.ok && result.directory_refusal.code === "unsupported_capability");
    assert.ok(result.directory.ok);
    assert.equal(result.directory.item_count, 3);
    if (capability === "commands") assert.deepEqual(result.directory.evidence, { closed: 1, open: 2 });
    else {
      assert.equal(typeof result.directory.evidence.exported_bytes, "number");
      assert.match(String(result.directory.evidence.sha256), /^[a-f0-9]{64}$/);
    }
  }
  let reads = 0;
  const monitored = { async read() { reads++; return client.listAllComplete(); }, capabilities: ["read", "mutate"] as const };
  const refusal = await executeCapabilityLaboratory(monitored, "commands", "mutate");
  assert.equal(refusal.ok, false);
  assert.equal(reads, 0, "unsupported mutation must never reach the provider, even if it advertises writes");
  const deniedRead = await executeCapabilityLaboratory({ ...monitored, capabilities: [] }, "commands");
  assert.equal(deniedRead.ok, false);
  assert.equal(reads, 0);
  assert.ok((await executeCapabilityLaboratory(monitored, "commands")).ok);
  assert.equal(reads, 1);
  assert.equal(durableFiles(pmRoot), before);

  const sdk = createExtensionCommandSdk(pmRoot, client);
  const ext = await createExtensionTestHarness(extension, { capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  for (const command of ["starter lab", "starter-lab export"]) {
    const preflight = await ext.runPreflightOverride({
      command, args: [], options: {}, global: {}, pm_root: pmRoot,
      decision: { enforce_item_format_gate: true, run_preflight_item_format_sync: false,
        run_extension_migrations: true, enforce_mandatory_migration_gate: false },
    });
    assert.equal(preflight.decision.run_extension_migrations, false);
  }
  for (const options of [{}, { capability: "commands", operation: "read" }, { capability: "importers" }]) {
    const command = await ext.runCommand({ command: "starter lab", options, pmRoot, sdk });
    assert.equal(command.handled, true);
    assert.equal(command.exitCode, undefined);
    assert.equal((command.result as { identical: boolean }).identical, true);
  }
  const exported = await runExportLaboratory({ options: {}, sdk });
  assert.equal("identical" in exported && exported.identical, true);
  const denied = await ext.runCommand({ command: "starter lab", options: { operation: "mutate" }, pmRoot, sdk });
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.errorCode, "laboratory_refused");
  assert.ok(denied.remediation);
  for (const options of [{ capability: "invalid" }, { operation: "delete" }, { capability: 42 }, { capability: "importers", operation: "read" }]) {
    const invalid = await runLaboratoryCommand({ options });
    assert.ok("exit_code" in invalid);
    assert.equal(invalid.exit_code, 2);
  }
  // An uninitialized real tracker yields a stable refusal without exposing source paths/errors.
  const missing = new PmClient({ pmRoot: join(scratch, "missing"), noExtensions: true });
  for (const adapter of [createDirectoryLaboratoryAdapter(missing), createSyntheticRemoteLaboratoryAdapter(missing)]) {
    const failed = await executeCapabilityLaboratory(adapter, "commands");
    assert.ok(!failed.ok && failed.code === "source_unavailable");
    assert.ok(!JSON.stringify(failed).includes(scratch));
  }
  const unavailable = await runLaboratoryCommand({ options: {}, sdk: createExtensionCommandSdk("", missing) });
  assert.ok("exit_code" in unavailable && unavailable.exit_code === 1);

  // A changing real tracker demonstrates parity failure rather than silently claiming equivalence.
  let calls = 0;
  const changing = { async listAllComplete() {
    if (++calls === 2) await client.create({ title: "Concurrent addition", type: "Task" });
    return client.listAllComplete();
  } };
  const changed = await runCapabilityLaboratory(changing, "commands");
  assert.equal(changed.identical, false);
});

test("packaged CLI executes and refuses in a plain tracker with no Git executable", async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "starter-lab-cli-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const pmRoot = join(scratch, ".agents/pm");
  const client = new PmClient({ pmRoot, noExtensions: true });
  await client.init("lab", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  await client.create({ title: "CLI probe", type: "Task" });
  const packageRoot = resolve(import.meta.dirname, "..");
  const cli = join(packageRoot, "node_modules/@unbrained/pm-cli/dist/cli.js");
  const installed = spawnSync(process.execPath, [cli, "--path", pmRoot, "extension", "install", packageRoot], { cwd: scratch, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  symlinkSync(process.execPath, join(scratch, "node"));
  const env = { ...process.env, PATH: scratch, GIT_CEILING_DIRECTORIES: dirname(scratch) };
  const before = durableFiles(pmRoot);
  for (const capability of ["commands", "importers"]) {
    const result = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "lab", "--capability", capability, "--json"], { cwd: scratch, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout) as { identical: boolean };
    assert.equal(receipt.identical, true);
    assert.ok(Buffer.byteLength(result.stdout) < 2400);
  }
  const exported = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter-lab", "export", "--json"], { cwd: scratch, env, encoding: "utf8" });
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /exported_bytes/);
  const toon = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "lab"], { cwd: scratch, env, encoding: "utf8" });
  assert.equal(toon.status, 0, toon.stderr);
  assert.match(toon.stdout, /identical: true/);
  const refused = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "lab", "--operation", "mutate", "--json"], { cwd: scratch, env, encoding: "utf8" });
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stdout, /unsupported_capability/);
  assert.match(refused.stdout, /remediation/);
  assert.equal(durableFiles(pmRoot), before);
});

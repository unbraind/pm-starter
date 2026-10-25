/** Compare the origin/main build and this build on immutable public tracker copies. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { ExtensionModule } from "@unbrained/pm-cli/sdk/authoring";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension, { readPmItems, type PmReadOutcome } from "../index.ts";

/** Compare durable state while permitting derived SDK caches in each copy. */
function fingerprint(root: string): string {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .filter((entry) => !["runtime", "locks", "search", "extensions"].includes(entry.name))
    .map((entry) => `${entry.name}:${entry.isDirectory() ? fingerprint(join(root, entry.name))
      : createHash("sha256").update(readFileSync(join(root, entry.name))).digest("hex")}`).join("\n");
}

/** Run the same demo and exporter through real host dispatch, capturing printed JSON. */
async function outputs(module: ExtensionModule, pmRoot: string) {
  const client = new PmClient({ pmRoot, noExtensions: true });
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const ext = await createExtensionTestHarness(module, { capabilities: [
    "commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services",
  ] });
  const demo = await ext.runCommand({ command: "starter demo", pmRoot, sdk });
  const lines: string[] = [];
  const saved = console.log;
  console.log = (value: unknown) => { lines.push(String(value)); };
  try {
    const exported = await ext.runExporter({ exporter: "starter-demo", pmRoot });
    return { demo: demo.result, exporter: exported.result, stdout: lines.join("\n") };
  } finally { console.log = saved; }
}

const [baselineEntry, ...corpora] = process.argv.slice(2);
assert.ok(baselineEntry && corpora.length, "Pass the origin/main build entry and one or more tracker copies.");
const baseline = createRequire(import.meta.url)(resolve(baselineEntry)) as {
  default: ExtensionModule;
  readPmItems(root: string): PmReadOutcome;
};
for (const [index, corpus] of corpora.entries()) {
  const pmRoot = resolve(corpus);
  const before = fingerprint(pmRoot);
  const client = new PmClient({ pmRoot, noExtensions: true });
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const oldRows = baseline.readPmItems(pmRoot);
  const newRows = await readPmItems({ sdk });
  assert.ok(oldRows.ok, "baseline must complete successfully");
  assert.ok(newRows.ok, newRows.ok ? "complete" : newRows.reason);
  // CLI JSON omits undefined optional properties; compare the delivered wire value.
  assert.deepEqual(JSON.parse(JSON.stringify(newRows)), oldRows);
  const oldOutputs = await outputs(baseline.default, pmRoot);
  const newOutputs = await outputs(extension, pmRoot);
  assert.deepEqual(newOutputs, oldOutputs);
  assert.equal(fingerprint(pmRoot), before, "all durable corpus files must stay byte-identical");
  console.log(JSON.stringify({ corpus: index + 1, items: oldRows.items.length, assertions: 5,
    identical: ["reader rows (JSON wire value)", "demo result", "exporter result", "exporter stdout", "durable files"] }));
}

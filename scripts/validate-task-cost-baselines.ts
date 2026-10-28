/** Reproduce read-only measurements on an explicit public tracker copy outside git. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { runTaskCostBaselines } from "../baselines.ts";

/** Hash every file, requiring read-only regular files/directories and refusing links. */
function fingerprint(root: string): string {
  assert.equal(statSync(root).mode & 0o222, 0, "Use a read-only public tracker copy.");
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  return createHash("sha256").update(entries.map((entry) => {
    assert.ok(!entry.isSymbolicLink(), "Tracker copies must not contain symlinks.");
    const path = join(root, entry.name);
    assert.equal(statSync(path).mode & 0o222, 0, "Every copied file must be read-only.");
    return `${entry.name}:${entry.isDirectory() ? fingerprint(path) : createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  }).join("\n")).digest("hex");
}

const input = process.argv[2];
assert.ok(input, "Pass a public tracker copy; see docs/agent-task-cost-baselines.md.");
const pmRoot = resolve(input);
const before = fingerprint(pmRoot);
const client = new PmClient({ pmRoot, noExtensions: true, author: "baseline-validation" });
const sdk = createExtensionCommandSdk(pmRoot, client);
const host = { client, isItemNotFoundError: (error: unknown) => sdk.isItemNotFoundError(error) };
const declared = await runTaskCostBaselines(host, { mode: "declare", corpus_id: "pm-starter-public", scenario: "all", repeats: 3 });
assert.ok(declared.ok, JSON.stringify(declared));
const probed = await runTaskCostBaselines(host, { mode: "probe", corpus_id: "pm-starter-public", declarations: declared.declarations });
assert.ok(probed.ok, JSON.stringify(probed));
assert.deepEqual(probed.scenarios.map((r) => r.answer), declared.scenarios.map((r) => r.expected_answer));
assert.equal(fingerprint(pmRoot), before, "The read-only public copy must remain byte-identical.");
console.log(JSON.stringify({ runtime: probed.runtime, corpus: probed.corpus, corpus_observation: probed.corpus_observation,
  process_calls: probed.process_calls, scenarios: probed.scenarios, probe: probed.probe, source_unchanged: true }, null, 2));

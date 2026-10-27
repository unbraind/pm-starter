import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { PmClient, createExtensionCommandSdk, readSettings, resolveRuntimeStatusRegistry, serializeItemDocument, getItemPath } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import {
  assertTaskCostReport, budgetWorsened, bytesDiv4Estimate, ceilBytesDiv4, ceilRational, corpusDigest, exactMedian, exactRational,
  indexStatusRoles, orientationAnswer, parseSchemaListStatuses, parseTaskCostDeclaration, parseTaskCostRequest, rationalCompare,
  resolveStatusId, taskCostRuntime, taskCostRequestFromOptions, resumeAnswer, targetedAnswer, formatRational, runTaskCostBaselines, runTaskCostCommand, subtractRationals, syntheticRemoteClient, TASK_COST_DECLARATION_SCHEMA,
  type TaskCostHost, type TaskCostSuccess,
} from "../baselines.ts";
/** Fingerprint authoritative tracker bytes and ignore host caches. */
function fingerprint(root: string): string {
  return readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    .filter((entry) => !["runtime", "locks", "search", "extensions"].includes(entry.name))
    .map((entry) => `${entry.name}:${entry.isDirectory() ? fingerprint(join(root, entry.name)) : createHash("sha256").update(readFileSync(join(root, entry.name))).digest("hex")}`).join("\n");
}

/** Non-git tracker. Git cannot see an enclosing repository. */
async function tracker(t: TestContext, prefix = "baseline") {
  const directory = mkdtempSync(join(tmpdir(), "starter-baseline-"));
  const savedPath = process.env.PATH;
  const savedCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = dirname(directory);
  t.after(() => {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    if (savedCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
    rmSync(directory, { recursive: true, force: true });
  });
  const pmRoot = join(directory, ".agents/pm");
  const client = new PmClient({ pmRoot, noExtensions: true, author: "baseline-test" });
  await client.init(prefix, { defaults: true, mergeFence: false, agentGuidance: "skip" });
  const sdk = createExtensionCommandSdk(pmRoot, client, "baseline-test");
  const host: TaskCostHost = { client, isItemNotFoundError: (error) => sdk.isItemNotFoundError(error) };
  return { directory, pmRoot, client, sdk, host };
}

test("exact rationals decide inclusive boundaries that a binary float can miss", () => {
  assert.deepEqual(exactMedian([1, 2]), { n: 3, d: 2 });
  assert.equal(rationalCompare(exactRational(2, 4), exactRational(1, 2)), 0);
  assert.equal(rationalCompare(exactMedian([1, 2]), exactRational(1)), 1);
  assert.equal(rationalCompare(exactMedian([1, 2]), exactRational(2)), -1);
  assert.equal(budgetWorsened(exactRational(2), exactRational(10), exactRational(3), exactRational(11)), true);
  assert.equal(budgetWorsened(exactRational(2), exactRational(10), exactRational(2), exactRational(11)), false);
  assert.equal(budgetWorsened(exactRational(3, 2), exactRational(5, 2), exactRational(2), exactRational(3)), true);
  assert.equal(bytesDiv4Estimate(5).label, "estimate");
  assert.deepEqual(bytesDiv4Estimate({ n: 5, d: 1 }).value, { n: 5, d: 4 });
  assert.equal(ceilBytesDiv4(5), 2);
  assert.equal(ceilRational(exactRational(5, 4)), 2);
  assert.deepEqual(subtractRationals(exactRational(5, 2), exactRational(1)), { n: 3, d: 2 });
  assert.equal(formatDisplay(), "1.5");
});

/** Display helper stays out of the decision path; this only checks the label contract. */
function formatDisplay(): string {
  return bytesDiv4Estimate(6).display;
}

test("orientation, targeted-read and resume agree across runtimes and a full list worsens the budget", async (t) => {
  const { directory, pmRoot, client, host, sdk } = await tracker(t);
  await client.create({ id: "item-a", type: "Task", title: "Alpha", priority: 1, unset: ["parent", "assignee", "sprint", "release"], author: "baseline-test" });
  await client.create({ id: "item-b", type: "Task", title: "Beta", status: "closed", closeReason: "done", priority: 2, unset: ["parent", "assignee", "sprint", "release"], author: "baseline-test" });
  const before = fingerprint(pmRoot);
  process.env.PATH = directory;
  const contexts: unknown[] = [];
  const observed = intercept(client, (method, value) => {
    if (method === "context") { const v = value as Record<string, unknown>; contexts.push([v.high_level, v.low_level, v.blocked_fallback]); }
    return value;
  });
  const declared = await runTaskCostBaselines({ ...host, client: observed }, { mode: "declare", scenario: "all", corpus_id: "example", repeats: 2 });
  assert.ok(declared.ok, JSON.stringify({ result: declared, contexts }));
  assert.equal(declared.scenarios.length, 3);
  for (const scenario of declared.scenarios) {
    assert.equal(scenario.corpus.version.startsWith("digest:"), true);
    assert.equal(scenario.expected_answer, scenario.answer);
    assert.equal(scenario.estimate.label, "estimate");
    assert.equal(scenario.identical_answer, true);
    assert.equal(scenario.not_model_performance, true);
  }
  assert.equal(declared.corpus_observation.excluded_from_scenario_budget, true);
  const orientation = declared.scenarios[0];
  assert.ok(orientation);
  const probed = await runTaskCostBaselines(host, {
    mode: "probe", scenario: "orientation", corpus_id: "example", corpus_version: orientation.corpus.version,
    expected_answer: orientation.expected_answer, repeats: 2, id: "orient-a",
  });
  assert.ok(probed.ok, JSON.stringify(probed));
  assert.equal(probed.probe?.worsened, true);
  assert.equal(probed.probe?.injected, "listAllComplete");
  assert.ok(probed.scenarios[0] && !probed.scenarios[0].tools.includes("listAllComplete"));
  assert.equal(fingerprint(pmRoot), before);
  const ext = await createExtensionTestHarness(extension, { capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  const command = await ext.runCommand({ command: "starter baseline", options: { mode: "declare", scenario: "targeted-read", "corpus-id": "example", repeats: "1" }, pmRoot, sdk });
  assert.equal(command.exitCode, undefined);
  assert.equal((command.result as { ok?: boolean }).ok, true);
  const missing = await runTaskCostCommand({ options: {}, sdk });
  assert.equal(missing.ok, false);
  assert.equal(missing.exit_code, 2);
  const unavailable = await runTaskCostCommand({ options: { mode: "declare", "corpus-id": "example" } });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, "sdk_unavailable");
  const mismatch = await runTaskCostBaselines(host, { mode: "run", scenario: "orientation", corpus_id: "example", corpus_version: "other-version", expected_answer: "orientation:active=9,blocked=0,done=0,canceled=0,terminal=0,focus=abc", repeats: 1 });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "answer_mismatch");
});

test("status roles come from the registry, including random custom statuses", async (t) => {
  const { pmRoot, client, host } = await tracker(t);
  const roles = [["active"], ["blocked"], ["terminal", "terminal_done"], ["terminal", "terminal_canceled"], ["draft"]];
  for (let index = 0; index < roles.length; index += 1) {
    const name = `custom${(Math.imul(index + 17, 7919) >>> 0).toString(36)}x`;
    await client.schemaAddStatus(name, { role: roles[index], alias: [`alias-${name}`] });
    await client.create({ id: `item-${index}`, type: "Task", title: name, status: `alias ${name}`, closeReason: "custom", priority: 2, unset: ["parent"], author: "baseline-test" });
  }
  const registry = resolveRuntimeStatusRegistry((await readSettings(pmRoot)).schema);
  const listed = parseSchemaListStatuses(await client.schemaList());
  assert.ok(listed);
  const index = indexStatusRoles(listed);
  assert.equal(index.openStatusId, registry.open_status);
  for (const item of (await client.listAllComplete()).items) {
    const resolved = resolveStatusId(item.status, index);
    assert.equal(resolved !== undefined && index.active.has(resolved), registry.active_statuses.has(item.status) || [...registry.active_statuses].includes(resolved ?? ""));
    assert.equal(resolved !== undefined && index.done.has(resolved), registry.terminal_done_statuses.has(resolved ?? ""));
    assert.equal(resolved !== undefined && index.canceled.has(resolved), registry.terminal_canceled_statuses.has(resolved ?? ""));
    assert.equal(resolved !== undefined && index.blocked.has(resolved), registry.blocked_statuses.has(resolved ?? ""));
    assert.equal(resolved !== undefined && index.terminal.has(resolved), registry.terminal_statuses.has(resolved ?? ""));
  }
  const declared = await runTaskCostBaselines(host, { mode: "declare", scenario: "orientation", corpus_id: "custom", repeats: 1 });
  assert.ok(declared.ok, JSON.stringify(declared));
  assert.match(declared.scenarios[0]?.answer ?? "", /^orientation:active=\d+,blocked=\d+,done=\d+,canceled=\d+,terminal=\d+,focus=[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(declared).includes("custom0x"), false);
  const rows = (await client.listAllComplete()).items.map((item) => ({ id: item.id, status: item.status }));
  assert.equal(orientationAnswer(rows, index).includes("unassigned"), false);
  assert.equal(corpusDigest(rows.map((row) => ({ ...row, updated_at: "2020-01-01T00:00:00.000Z" }))).startsWith("digest:"), true);
});


/** One strict declaration fixture; the same parser validates actual producer output. */
function declaration() {
  return { schema: TASK_COST_DECLARATION_SCHEMA, id: "baseline-a", scenario: "orientation", corpus: { id: "example", version: "v1" }, expected_answer: "orientation:active=1", repeats: 1 };
}

test("strict request and declaration schema fuzz their dense, bounded domains", () => {
  const good = declaration();
  assert.ok(parseTaskCostDeclaration(good));
  assert.ok(parseTaskCostDeclaration({ ...good, scenario: "targeted-read", target_id: " item-a\r\n" }));
  assert.equal(parseTaskCostDeclaration({ ...good, corpus: { id: " example\r\n", version: " v1\r\n" }, expected_answer: " orientation:active=1\r\n" })?.expected_answer, good.expected_answer);
  const extreme = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 9, 1.5, Number.MAX_SAFE_INTEGER, "", [], new Date(), "x".repeat(600), "a\nb", {}, true];
  for (const value of extreme) {
    assert.equal(parseTaskCostDeclaration(value), undefined);
    for (const key of ["schema", "id", "scenario", "corpus", "expected_answer", "repeats"]) assert.equal(parseTaskCostDeclaration({ ...good, [key]: value }), undefined, key);
    if (value !== undefined) {
      assert.equal(parseTaskCostDeclaration({ ...good, target_id: value }), undefined);
      for (const key of ["mode", "scenario", "repeats", "corpus_id", "corpus_version", "expected_answer", "target_id", "id", "declarations"]) {
        const request: Record<string, unknown> = { mode: "run", corpus_id: "example", corpus_version: "v1", expected_answer: "orientation:active=1", [key]: value };
        assert.equal(parseTaskCostRequest(request), undefined, `${key}: ${String(value)}`);
      }
    }
  }
  for (const corpus of [{ id: "example" }, { version: "v1" }, { id: "example", version: "v1", extra: true }]) assert.equal(parseTaskCostDeclaration({ ...good, corpus }), undefined);
  assert.equal(parseTaskCostDeclaration({ ...good, extra: true }), undefined);
  assert.equal(parseTaskCostDeclaration({ ...good, [Symbol("extra")]: true }), undefined);
  assert.equal(parseTaskCostDeclaration({ ...good, scenario: "targeted-read" }), undefined);
  assert.equal(parseTaskCostRequest({ corpus_id: "example", extra: true }), undefined);
  assert.equal(parseTaskCostRequest({ corpus_id: "example", scenario: "all" }), undefined);
  assert.equal(parseTaskCostRequest({ corpus_id: "example", corpus_version: "v1" }), undefined);
  assert.equal(parseTaskCostRequest({ corpus_id: "example", expected_answer: "ok" }), undefined);
  assert.ok(parseTaskCostRequest({ mode: "declare", corpus_id: "example" }));
  assert.ok(parseTaskCostRequest({ corpus_id: "example", declarations: [good] }));
  assert.ok(parseTaskCostRequest({ corpus_id: "example", scenario: "all", declarations: [good] }));
  assert.equal(parseTaskCostRequest({ corpus_id: "example", declarations: [good], target_id: "item-a" }), undefined);
  assert.equal(parseTaskCostRequest({ corpus_id: "example", declarations: [good, good, good, good] }), undefined);
  const sparse = Array(1) as unknown[];
  assert.equal(parseTaskCostRequest({ corpus_id: "example", declarations: sparse }), undefined);
  assert.equal(parseTaskCostRequest({ corpus_id: "example", declarations: [null] }), undefined);
  for (const value of extreme) {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
      assert.throws(() => exactMedian([value]));
      if (!Number.isSafeInteger(value)) assert.throws(() => exactRational(value));
    }
  }
  assert.throws(() => exactRational(1, 0));
  assert.throws(() => exactMedian([]));
  assert.throws(() => exactMedian(Array(9).fill(1)));
  assert.throws(() => ceilRational({ n: -1, d: 1 }));
  assert.throws(() => subtractRationals({ n: Number.MAX_SAFE_INTEGER, d: 1 }, { n: -1, d: 1 }));
  assert.equal(bytesDiv4Estimate(0).display, "0");
  assert.deepEqual(exactRational(0, -3), { n: 0, d: 1 });
  for (let count = 0; count < 500; count++) {
    const numerator = (count * 7919) % 100003;
    const ratio = exactRational(numerator, 7);
    assert.equal(rationalCompare(ratio, ratio), 0);
    assert.equal(budgetWorsened(ratio, ratio, ratio, ratio), false);
    assert.equal(budgetWorsened(ratio, ratio, exactRational(numerator + 1, 7), exactRational(numerator + 1, 7)), true);
    assert.equal(ceilRational(ratio), Number((BigInt(numerator) + 6n) / 7n));
  }
});

/** Instrument real SDK transitions; responses still come from the native tracker. */
function intercept(client: TaskCostHost["client"], transform: (method: string, value: unknown, call: number) => unknown): TaskCostHost["client"] {
  let call = 0;
  return new Proxy(client, { get(target, property) {
    const value: unknown = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => transform(String(property), await Reflect.apply(value, target, args), ++call);
  } });
}

test("native refusal boundaries never return a success for malformed read contracts", async (t) => {
  const { client, host, pmRoot } = await tracker(t);
  const options = { mode: "declare", scenario: "orientation", corpus_id: "example", repeats: 1 };
  const empty = await runTaskCostBaselines(host, { ...options, scenario: "targeted-read" });
  assert.ok(!empty.ok && empty.code === "empty_tracker");
  await client.create({ id: "item-a", title: "Alpha", type: "Task", unset: ["parent", "assignee", "sprint", "release"] });
  const missing = await runTaskCostBaselines(host, { ...options, scenario: "targeted-read", target_id: "absent" });
  assert.ok(!missing.ok && missing.code === "item_not_found");
  const noClassifier = await runTaskCostBaselines({ client }, { ...options, scenario: "targeted-read", target_id: "absent" });
  assert.ok(!noClassifier.ok && noClassifier.code === "source_unavailable");
  const uninitialized = new PmClient({ pmRoot: join(pmRoot, "absent"), noExtensions: true });
  assert.equal((await runTaskCostBaselines({ client: uninitialized }, options)).ok, false);
  const faults: [string, string, (value: unknown) => unknown][] = [
    ["schemaList", "status_registry_unavailable", () => ({})],
    ["schemaList", "status_registry_unavailable", () => ({ statuses: { builtin: [], custom: [] } })],
    ["context", "orientation_contract_unavailable", () => ({})],
    ["context", "orientation_contract_unavailable", (v) => ({ ...v as object, high_level: null })],
    ["context", "orientation_contract_unavailable", (v) => ({ ...v as object, high_level: Array(1) })],
    ["context", "orientation_contract_unavailable", (v) => ({ ...v as object, high_level: [{}] })],
    ["context", "source_unavailable", () => 1n],
    ["listAllComplete", "source_unavailable", (v) => ({ ...v as object, complete_list: { item_count: Infinity } })],
    ["listAllComplete", "source_unavailable", (v) => ({ ...v as object, items: [{}] })],
  ];
  for (const [method, code, transform] of faults) {
    const result = await runTaskCostBaselines({ client: intercept(client, (name, value) => name === method ? transform(value) : value) }, options);
    assert.ok(!result.ok && result.code === code, `${method}: ${JSON.stringify(result)}`);
  }
  for (const items of [null, Array(1), [{}]]) {
    const result = await runTaskCostBaselines({ client: intercept(client, (method, value) => method === "list" ? { ...value as object, items } : value) }, { ...options, scenario: "resume" });
    assert.ok(!result.ok && result.code === "resume_contract_unavailable");
  }
  for (const patch of [{ has_more: null }, { has_more: true, next_cursor: "" }, { has_more: true, next_cursor: "loop" }, { has_more: true, next_cursor: "next", items: [] }]) {
    const result = await runTaskCostBaselines({ client: intercept(client, (method, value) => method === "list" ? { ...value as object, ...patch } : value) }, { ...options, scenario: "resume" });
    assert.ok(!result.ok && ["resume_contract_unavailable", "source_unavailable"].includes(result.code), JSON.stringify(result));
  }
  const wrongGet = await runTaskCostBaselines({ client: intercept(client, (method, value) => method === "get" ? {} : value) }, { ...options, scenario: "targeted-read", target_id: "item-a" });
  assert.ok(!wrongGet.ok && wrongGet.code === "item_not_found");
  let contexts = 0;
  const changed = await runTaskCostBaselines({ client: intercept(client, (method, value) => {
    if (method === "context" && ++contexts === 2) return { ...value as object, high_level: [], low_level: [], blocked_fallback: [] };
    return value;
  }) }, options);
  assert.ok(!changed.ok && changed.code === "runtime_answer_mismatch");
  contexts = 0;
  const repeatChanged = await runTaskCostBaselines({ client: intercept(client, (method, value) => {
    if (method === "context" && ++contexts === 2) return { ...value as object, high_level: [], low_level: [], blocked_fallback: [] };
    return value;
  }) }, { ...options, repeats: 2 });
  assert.ok(!repeatChanged.ok && repeatChanged.code === "runtime_answer_mismatch");
  const declarationRun = await runTaskCostBaselines(host, { ...options, scenario: "targeted-read", target_id: "item-a" });
  assert.ok(declarationRun.ok);
  const stale = await runTaskCostBaselines(host, { corpus_id: "example", declarations: declarationRun.declarations.map((d) => ({ ...d, corpus: { ...d.corpus, version: "digest:old" } })) });
  assert.ok(!stale.ok && stale.code === "corpus_mismatch");
  assert.ok(!(await runTaskCostBaselines(host, { corpus_id: "wrong", declarations: declarationRun.declarations })).ok);
});

test("producer reports and declarations validate and replay under 500 seeded sequences", async (t) => {
  const { client, host } = await tracker(t);
  await client.create({ id: "item-a", title: "Model anchor", type: "Task", unset: ["parent", "assignee", "sprint", "release"] });
  const declared = await runTaskCostBaselines(host, { mode: "declare", scenario: "all", corpus_id: "model", repeats: 1 });
  assert.ok(declared.ok);
  const history = [...declared.declarations];
  let seed = 0x51f17e;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const model = new Map(history.map((d) => [d.id, d]));
  for (let sequence = 0; sequence < 500; sequence++) {
    const older = history[next() % history.length]!;
    const variant = next() % 2 === 0 ? older : { ...older, id: ` ${older.id}\r\n`, corpus: { id: ` ${older.corpus.id}\r\n`, version: `${older.corpus.version}\r\n` }, expected_answer: `${older.expected_answer}\r\n` };
    const decoded = parseTaskCostDeclaration(JSON.parse(JSON.stringify(variant)));
    assert.deepEqual(decoded, model.get(older.id), `seeded sequence ${sequence}`);
    if (sequence % 25 === 0) {
      const native = await client.get("item-a", { fields: "id,status" });
      assert.equal(native.item.id, declared.declarations.find((d) => d.target_id)?.target_id);
      assert.equal(native.item.status, "open");
    }
    assert.ok(decoded);
    history.push(decoded);
  }
  const replay = await runTaskCostBaselines(host, { corpus_id: "model", declarations: declared.declarations });
  assert.ok(replay.ok);
  assert.deepEqual(replay.scenarios.map((r) => r.answer), declared.scenarios.map((r) => r.answer));
  assert.equal(assertTaskCostReport(replay), replay);
  const mutate = (change: (copy: TaskCostSuccess) => void) => {
    const copy = structuredClone(replay);
    change(copy);
    assert.throws(() => assertTaskCostReport(copy));
  };
  for (const value of [NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) mutate((v) => { Object.assign(v.corpus_observation, { delivered_bytes: value }); });
  mutate((v) => { Object.assign(v, { schema: "bad" }); });
  mutate((v) => { Object.assign(v, { process_calls: 1 }); });
  mutate((v) => { Object.assign(v, { process_scope: "all_processes" }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.ceil_estimate, { method: "bad" }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.estimate, { display: "wrong" }); });
  mutate((v) => { Object.assign(v.corpus_observation, { calls: 3 }); });
  mutate((v) => { Object.assign(v, { scenarios: [] }); });
  mutate((v) => { Object.assign(v.scenarios[0]!, { expected_answer: "bad" }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.estimate, { label: "measured" }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.estimate, { value: { n: 1, d: 0 } }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.estimate, { value: { n: 1, d: 1 } }); });
  mutate((v) => { Object.assign(v.scenarios[0]!, { elapsed_use: "budget" }); });
  mutate((v) => { Object.assign(v, { declarations: [] }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.calls, { min: 99 }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.delivered_bytes, { median: { n: 1, d: 1 } }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.ceil_estimate, { value: 99999 }); });
  assert.deepEqual(assertTaskCostReport(JSON.parse(JSON.stringify(replay)) as TaskCostSuccess), replay);
  mutate((v) => { Object.assign(v.scenarios[0]!.calls, { median: { n: 99, d: 1 } }); });
  mutate((v) => { Object.assign(v.scenarios[0]!.calls, { samples: Array(1) }); });
  mutate((v) => { Object.assign(v, { probe: { worsened: false } }); });
});

test("schema and CLI boundary corpus allows valid legacy tokens and refuses malformed shapes", () => {
  const definition = { id: "waiting", aliases: ["alias"], roles: ["active"] };
  const schema = { statuses: { builtin: [definition], custom: [] } };
  assert.equal(indexStatusRoles([definition]).openStatusId, "waiting");
  assert.throws(() => indexStatusRoles([{ ...definition, roles: [] }]));
  const index = indexStatusRoles([{ ...definition, aliases: ["alias", "", "alias"] }, { id: "finished", aliases: [], roles: ["terminal"] }, { id: "drafted", aliases: [], roles: ["draft"] }]);
  assert.equal(resolveStatusId("alias", index), "waiting");
  assert.equal(targetedAnswer("item-a", "unknown", index), "targeted-read:id=item-a,role=unassigned");
  assert.equal(targetedAnswer("item-a", "finished", index), "targeted-read:id=item-a,role=terminal");
  assert.equal(targetedAnswer("item-a", "drafted", index), "targeted-read:id=item-a,role=unassigned");
  assert.match(resumeAnswer(1, ["a", "a"], [], index), /duplicates=1/);
  assert.equal(formatRational(exactRational(1, 3)), "0.333");
  assert.deepEqual(taskCostRuntime({ bun: "1.3.0", node: "24.0.0" }), { engine: "bun", version: "1.3.0" });
  const rows = [{ id: "b", status: "waiting", updated_at: "v1" }, { id: "a", status: "waiting", updated_at: "v1" }, { id: "a", status: "waiting", updated_at: "v1" }];
  assert.equal(corpusDigest(rows), corpusDigest([...rows].reverse()));
  assert.equal(orientationAnswer(rows, index), orientationAnswer([...rows].reverse(), index));
  assert.ok(parseSchemaListStatuses(schema));
  for (const value of [null, [], new Date(), Object.create(null), {}, { statuses: {} }, { statuses: { builtin: null } }, { statuses: { builtin: Array(1), custom: [] } }]) assert.equal(parseSchemaListStatuses(value), undefined);
  for (const row of [null, {}, { ...definition, id: "" }, { ...definition, id: "x".repeat(65) }, { ...definition, aliases: [5] }, { ...definition, aliases: Array(1) }, { ...definition, aliases: Array(33).fill("alias") }, { ...definition, roles: null }]) assert.equal(parseSchemaListStatuses({ statuses: { builtin: [row], custom: [] } }), undefined);
  for (const root of [null, [], new Date(), Object.create(null)]) assert.equal(parseTaskCostRequest(root), undefined);
  const flags = { mode: "run", scenario: "all", repeats: "2", "corpus-id": "example", "corpus-version": "v1", "expected-answer": "ok", "target-id": "item-a", id: "example" };
  assert.equal(taskCostRequestFromOptions(flags).repeats, 2);
  assert.deepEqual(taskCostRequestFromOptions({ corpusId: "example", corpusVersion: "v1", expectedAnswer: "ok", targetId: "item-a" }), { corpus_id: "example", corpus_version: "v1", expected_answer: "ok", target_id: "item-a" });
  assert.equal(taskCostRequestFromOptions({ repeats: "bad" }).repeats, "bad");
  assert.equal(taskCostRequestFromOptions({ repeats: 1 }).repeats, 1);
  assert.deepEqual(taskCostRequestFromOptions({ declarations: "[]" }).declarations, []);
  assert.equal(taskCostRequestFromOptions({ declarations: "{" }).declarations, null);
  assert.deepEqual(taskCostRequestFromOptions({ declarations: [] }).declarations, []);
});

test("native pagination uses compact continuation envelopes and refuses a bounded incomplete traversal", async (t) => {
  const { client, pmRoot, host } = await tracker(t);
  const seed = await client.create({ id: "seed", title: "Native fixture producer", type: "Task", unset: ["parent", "assignee", "sprint", "release"] });
  // SDK-produced serialization; the real reader, sorter, cursor and projections remain in use.
  for (let number = 0; number < 51; number++) {
    const id = `baseline-row-${String(number).padStart(3, "0")}`;
    writeFileSync(getItemPath(pmRoot, "Task", id), serializeItemDocument({ metadata: { ...seed.item, id }, body: "" }));
  }
  const small = await runTaskCostBaselines(host, { mode: "declare", scenario: "resume", corpus_id: "pages", repeats: 1 });
  assert.ok(small.ok, JSON.stringify(small));
  assert.match(small.scenarios[0]!.answer, /pages=2,rows=52,duplicates=0/);
  for (let number = 51; number < 401; number++) {
    const id = `baseline-row-${String(number).padStart(3, "0")}`;
    writeFileSync(getItemPath(pmRoot, "Task", id), serializeItemDocument({ metadata: { ...seed.item, id }, body: "" }));
  }
  const large = await runTaskCostBaselines(host, { mode: "declare", scenario: "resume", corpus_id: "pages", repeats: 1 });
  assert.ok(!large.ok && large.code === "resume_contract_unavailable");
});

test("budget and corpus races fail truthfully while all read-only boundaries retain native state", async (t) => {
  const { client, host, sdk } = await tracker(t);
  const missingCommand = await runTaskCostCommand({ sdk, options: { mode: "declare", scenario: "targeted-read", "corpus-id": "races", "target-id": "absent", repeats: "1" } });
  assert.ok(!missingCommand.ok && missingCommand.code === "item_not_found");
  await client.create({ id: "item-a", title: "Race anchor", type: "Task", unset: ["parent", "assignee", "sprint", "release"] });
  const options = { mode: "declare", corpus_id: "races", repeats: 1 };
  const base = await runTaskCostBaselines(host, options);
  assert.ok(base.ok);
  const run = { mode: "probe", corpus_id: "races", declarations: base.declarations };
  let contexts = 0;
  const budget = await runTaskCostBaselines({ client: intercept(client, (method, value) => method === "context" && ++contexts < 3 ? { ...value as object, padding: "x".repeat(100000) } : value) }, run);
  assert.ok(!budget.ok && budget.code === "budget_not_worsened");
  contexts = 0;
  const changed = await runTaskCostBaselines({ client: intercept(client, (method, value) => method === "context" && ++contexts >= 3 ? { ...value as object, high_level: [], low_level: [], blocked_fallback: [] } : value) }, run);
  assert.ok(!changed.ok && changed.code === "runtime_answer_mismatch");
  const stale = await runTaskCostBaselines(host, { mode: "run", corpus_id: "races", corpus_version: "digest:old", expected_answer: "ok" });
  assert.ok(!stale.ok && stale.code === "corpus_mismatch");
  const probe = await runTaskCostBaselines(host, run);
  assert.ok(probe.ok && probe.probe);
  for (const key of ["delta_calls", "delta_bytes"] as const) {
    const wrong = structuredClone(probe);
    Object.assign(wrong.probe!, { [key]: { n: 99999, d: 1 } });
    assert.throws(() => assertTaskCostReport(wrong));
  }
  const sibling = { ...base.declarations[0]!, corpus: { id: "races", version: "other" } };
  assert.equal((await runTaskCostBaselines(host, { mode: "run", corpus_id: "races", declarations: [...base.declarations, sibling] })).ok, false);
  let lists = 0;
  const moving = await runTaskCostBaselines({ client: intercept(client, (method, value) => {
    if (method !== "listAllComplete" || ++lists !== 2) return value;
    const copy = structuredClone(value) as Awaited<ReturnType<typeof client.listAllComplete>>;
    copy.items[0]!.updated_at = "2000-01-01T00:00:00.000Z";
    return copy;
  }) }, options);
  assert.ok(!moving.ok && moving.code === "corpus_mismatch");
  const clock = process.hrtime.bigint;
  try {
    for (const delta of [-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
      let calls = 0n;
      process.hrtime.bigint = () => calls++ * delta;
      const invalid = await runTaskCostBaselines(host, options);
      assert.ok(!invalid.ok && invalid.code === "report_invalid", JSON.stringify(invalid));
    }
  } finally { process.hrtime.bigint = clock; }
});

test("shipped CLI formats compact JSON and TOON, replays declarations, and refuses without Git", async (t) => {
  const { directory, pmRoot, client } = await tracker(t);
  await client.create({ id: "item-a", title: "CLI anchor", type: "Task", unset: ["parent", "assignee", "sprint", "release"] });
  const packageRoot = resolve(import.meta.dirname, "..");
  const cli = join(packageRoot, "node_modules/@unbrained/pm-cli/dist/cli.js");
  const packed = join(directory, "package");
  mkdirSync(packed);
  for (const entry of ["dist", "manifest.json", "package.json", "README.md", "docs"]) cpSync(join(packageRoot, entry), join(packed, entry), { recursive: true });
  const installed = spawnSync(process.execPath, [cli, "--path", pmRoot, "extension", "install", packed], { cwd: directory, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  symlinkSync(process.execPath, join(directory, "node"));
  const childEnv = { ...process.env, PATH: directory, GIT_CEILING_DIRECTORIES: dirname(directory) };
  const invoke = (...args: string[]) => spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "baseline", ...args], { cwd: directory, env: childEnv, encoding: "utf8" });
  const before = fingerprint(pmRoot);
  const result = invoke("--mode", "declare", "--corpus-id", "cli", "--repeats", "1", "--json");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(Buffer.byteLength(result.stdout) < 6000);
  const report = JSON.parse(result.stdout) as TaskCostSuccess;
  assert.equal(report.ok, true);
  const replay = invoke("--corpus-id", "cli", "--declarations", JSON.stringify(report.declarations), "--json");
  assert.equal(replay.status, 0, replay.stderr + replay.stdout);
  assert.equal(JSON.parse(replay.stdout).scenarios[0].answer, report.scenarios[0]!.answer);
  const toon = invoke("--mode", "declare", "--corpus-id", "cli", "--repeats", "1");
  assert.equal(toon.status, 0, toon.stderr);
  assert.match(toon.stdout, /not_model_performance: true/);
  for (const args of [["--repeats", "NaN"], ["--declarations", "{"], ["--target-id", "bad id"]]) {
    const refusal = invoke("--mode", "declare", "--corpus-id", "cli", ...args, "--json");
    assert.equal(refusal.status, 2, refusal.stderr);
    const value = JSON.parse(refusal.stdout) as { code: string; remediation: string };
    assert.equal(value.code, "invalid_request");
    assert.ok(value.remediation);
  }
  assert.equal(fingerprint(pmRoot), before);
});

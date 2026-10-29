/** Genuine non-git SDK reads, model-based resume proofs and transport fault injection. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import type { ListOptions, PmReadOutputOptions } from "@unbrained/pm-cli/sdk/core";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import { consumePaginated, parseConsumerRequest, runConsumerCommand, type ConsumerCheckpoint, type ConsumerHost, type ConsumerResult } from "../paginated-consumer.ts";

/** Hash authoritative bytes; host-owned derived caches are outside this recipe's mutation claims. */
function fingerprint(root: string): string {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .filter((entry) => !["runtime", "locks", "search", "extensions"].includes(entry.name))
    .map((entry) => `${entry.name}:${entry.isDirectory() ? fingerprint(join(root, entry.name))
      : createHash("sha256").update(readFileSync(join(root, entry.name))).digest("hex")}`).join("\n");
}

/** Use a native tracker with explicit scope fields and no ambient git repository. */
async function tracker(t: TestContext, count = 12, longIds = false) {
  const directory = mkdtempSync(join(tmpdir(), "starter-consumer-"));
  const savedPath = process.env.PATH;
  const savedCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = dirname(directory);
  t.after(() => {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    if (savedCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
    rmSync(directory, { recursive: true, force: true });
  });
  const pmRoot = join(directory, ".agents/pm");
  const client = new PmClient({ pmRoot, noExtensions: true, author: "consumer-test" });
  await client.init("consumer", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  const statuses: string[] = [];
  for (const [index, role] of [[0, ["active"]], [1, ["blocked"]], [2, ["terminal", "terminal_done"]], [3, ["terminal", "terminal_canceled"]]] as const) {
    const status = `phase_${index}_${(Math.imul(index + 31, 7919) >>> 0).toString(16)}`;
    await client.schemaAddStatus(status, { role: [...role] }); statuses.push(status);
  }
  for (let index = 0; index < count; index++) {
    await client.create({ id: `consumer-${String(index).padStart(3, "0")}${longIds ? "-" + "x".repeat(180) : ""}`,
      type: "Task", title: `  Native title ${index}  `, description: ` A\r\n B ${index} `,
      body: ` Body\r\n ${index} \n`, status: statuses[index % statuses.length], closeReason: "Synthetic lifecycle state",
      parent: "none", goal: "none", objective: "none", sprint: "none", release: "none", assignee: "none",
      priority: index % 5, tags: "one,two", dep: index === 0 ? [] : [`id=consumer-000${longIds ? "-" + "x".repeat(180) : ""},kind=related`],
      comment: ["text=Native comment"], note: ["text=Native note"], learning: ["text=Native learning"],
      file: ["path=paginated-consumer.ts,scope=project"], doc: ["path=README.md,scope=project"], test: ["command=node --version,scope=project"] });
  }
  const host: ConsumerHost = { client, sourceKey: pmRoot };
  return { client, host, pmRoot, directory, sdk: createExtensionCommandSdk(pmRoot, client) };
}

/** Narrow a successful test result and expose a useful failure diagnosis. */
function success(result: ConsumerResult): Extract<ConsumerResult, { ok: true }> {
  assert.ok(result.ok, JSON.stringify(result)); return result;
}

/** Faults modify a real native response at its transport boundary; no SDK/backend is mocked. */
function faultHost(host: ConsumerHost, mutate: (page: Record<string, unknown>) => void): ConsumerHost {
  return { ...host, client: { async list<Options extends ListOptions & PmReadOutputOptions>(options?: Options) {
    const page = await host.client.list(options); mutate(page as Record<string, unknown>); return page;
  } } };
}

test("cancel after page two and resume after the last admission, without duplicates or tracker writes", async (t) => {
  const { host, client, directory, pmRoot, sdk } = await tracker(t);
  const expected = (await client.listAllComplete({ includeBody: true })).items;
  const model = (await client.list({ status: "all", fields: "id", sort: "created_at", order: "asc", noTruncate: true })).items.map(({ id }) => id);
  const before = fingerprint(pmRoot);
  process.env.PATH = directory;
  const controller = new AbortController(); const ids: string[] = [];
  const first = success(await consumePaginated(host, { pageSize: 2, maxPages: 16 }, {
    signal: controller.signal, onPage(rows, checkpoint) { ids.push(...rows); if (checkpoint.pages === 2) controller.abort(); },
  }));
  assert.equal(first.stop, "canceled"); assert.equal(first.checkpoint.admitted, 4);
  assert.equal(first.checkpoint.last_id, ids.at(-1));
  const serialized = JSON.parse(JSON.stringify(first.checkpoint));
  const resumed = success(await consumePaginated(host, { checkpoint: serialized, maxPages: 16 }, { onPage(rows) { ids.push(...rows); } }));
  assert.equal(resumed.stop, "complete"); assert.deepEqual(ids, model);
  assert.equal(new Set(ids).size, expected.length);
  const peers = await Promise.all([consumePaginated(host, { checkpoint: serialized, maxPages: 16 }), consumePaginated(host, { checkpoint: serialized, maxPages: 16 })]);
  assert.deepEqual(peers[0], peers[1]); assert.equal(success(peers[0]).admitted_this_call, expected.length - 4);
  assert.equal(success(await consumePaginated(host, { checkpoint: resumed.checkpoint })).admitted_this_call, 0);
  assert.deepEqual((await client.listAllComplete({ includeBody: true })).items, expected);
  assert.equal(fingerprint(pmRoot), before);
  const ext = await createExtensionTestHarness(extension, { capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
  const preflight = await ext.runPreflightOverride({ command: "starter consume", args: [], options: {}, global: {}, pm_root: pmRoot,
    decision: { enforce_item_format_gate: true, run_preflight_item_format_sync: false, run_extension_migrations: true, enforce_mandatory_migration_gate: false } });
  assert.equal(preflight.decision.run_extension_migrations, false);
  const command = await ext.runCommand({ command: "starter consume", options: { pageSize: "2", maxPages: "2" }, pmRoot, sdk });
  assert.equal(success(command.result as ConsumerResult).checkpoint.admitted, 4);
});

test("native snapshot continuation is consumed unchanged and a changed snapshot yields typed recovery", async (t) => {
  const { host, client, pmRoot } = await tracker(t, 20, true);
  const rows: string[] = [];
  const first = success(await consumePaginated(host, { mode: "output", pageTokens: 1400, maxPages: 1, tokenBudget: 100000 }, { onPage(ids) { rows.push(...ids); } }));
  assert.equal(first.stop, "page_limit"); assert.ok(first.checkpoint.output_cursor);
  const second = success(await consumePaginated(host, { checkpoint: first.checkpoint, maxPages: 16 }, { onPage(ids) { rows.push(...ids); } }));
  assert.equal(second.stop, "complete"); assert.equal(new Set(rows).size, 20); assert.equal(rows.length, 20);
  const state = (await client.listAllComplete({ includeBody: true })).items;
  const before = fingerprint(pmRoot);
  const wrong = { ...host, sourceKey: "another connection" };
  const sourceRefusal = await consumePaginated(wrong, { checkpoint: first.checkpoint });
  assert.ok(!sourceRefusal.ok && sourceRefusal.code === "wrong_source");
  assert.equal(fingerprint(pmRoot), before);
  await client.create({ type: "Task", title: "Peer added a row", parent: "none", goal: "none", objective: "none", sprint: "none", release: "none" });
  const changed = (await client.listAllComplete({ includeBody: true })).items;
  const rejected = await consumePaginated(host, { checkpoint: first.checkpoint });
  assert.ok(!rejected.ok && rejected.code === "cursor_rejected", JSON.stringify(rejected));
  assert.match(rejected.native_code ?? "", /cursor/);
  assert.equal(rejected.checkpoint?.admitted, first.checkpoint.admitted);
  assert.ok(state.length < changed.length);
  assert.deepEqual((await client.listAllComplete({ includeBody: true })).items, changed);
});

test("cancellation at every real read boundary preserves unadmitted cursor and charges actual host cost", async (t) => {
  const { host, directory } = await tracker(t);
  process.env.PATH = directory;
  for (const boundary of [0, 1, 2, 3]) {
    const controller = new AbortController(); let calls = 0;
    if (boundary === 0) controller.abort();
    const observed = faultHost(host, () => { if (++calls === boundary) controller.abort(); });
    const first = success(await consumePaginated(observed, { pageSize: 2, maxPages: 16 }, { signal: controller.signal }));
    assert.equal(first.stop, "canceled"); assert.equal(first.checkpoint.admitted, Math.max(0, boundary - 1) * 2);
    assert.equal(calls, boundary); assert.equal(first.checkpoint.spent_tokens > 0, boundary > 0);
    const remainder = success(await consumePaginated(host, { checkpoint: first.checkpoint, maxPages: 16 }));
    assert.equal(remainder.stop, "complete"); assert.equal(remainder.checkpoint.admitted, 12);
  }
});

test("native budget omission, exhausted task, empty sources, observer failures and typed input refusals", async (t) => {
  const { host, client, pmRoot, sdk } = await tracker(t, 0);
  assert.equal(success(await consumePaginated(host)).stop, "complete");
  assert.ok(!(await consumePaginated(host, { maxPages: Infinity })).ok);
  assert.ok(!(await runConsumerCommand({ pm_root: pmRoot, options: {} })).ok);
  assert.ok(!(await runConsumerCommand({ pm_root: pmRoot, options: { maxPages: "Infinity" }, sdk })).ok);
  assert.ok(!(await runConsumerCommand({ pm_root: pmRoot, options: { checkpoint: "{" }, sdk })).ok);
  const budget = await consumePaginated(host, { tokenBudget: 256 });
  assert.ok(!budget.ok && budget.code === "host_refused", JSON.stringify(budget));
  assert.ok(budget.checkpoint);
  const exhausted = { ...budget.checkpoint, spent_tokens: budget.checkpoint.token_budget };
  assert.equal(success(await consumePaginated(host, { checkpoint: exhausted })).stop, "task_budget");
  assert.equal(success(await consumePaginated(host, { checkpoint: budget.checkpoint, tokenBudget: 16000 })).stop, "complete");
  const observer = await consumePaginated(host, {}, { onPage() { throw new Error("observer failed"); } });
  assert.ok(!observer.ok && observer.code === "observer_failed" && observer.checkpoint?.done);
  const unavailable = await consumePaginated({ sourceKey: "uninitialized", client: new PmClient({ pmRoot: join(pmRoot, "uninitialized"), noExtensions: true }) });
  assert.ok(!unavailable.ok && unavailable.code === "source_unavailable");
  const badCursor = success(await consumePaginated(host));
  const rejection = await consumePaginated(host, { checkpoint: { ...badCursor.checkpoint, done: false, after: "bad cursor" } });
  assert.ok(!rejection.ok && rejection.code === "cursor_rejected");
  const before = process.listenerCount("SIGINT");
  const cancelingClient = new Proxy(client, { get(target, key) {
    if (key === "list") return async <Options extends ListOptions & PmReadOutputOptions>(options?: Options) => {
      const result = await target.list(options); process.emit("SIGINT"); return result;
    };
    const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const canceled = success(await runConsumerCommand({ pm_root: pmRoot, sdk: { ...sdk, client: cancelingClient }, options: {} }));
  assert.equal(canceled.stop, "canceled"); assert.equal(canceled.checkpoint.admitted, 0);
  assert.equal(process.listenerCount("SIGINT"), before);
});

test("one strict request schema fuzzes numeric extremes, sparse arrays, accessors and checkpoint invariants", async (t) => {
  const { host } = await tracker(t, 1);
  const checkpoint = success(await consumePaginated(host)).checkpoint;
  assert.deepEqual(parseConsumerRequest({}), {});
  for (const mode of ["producer", "output"]) assert.ok(parseConsumerRequest({ mode }));
  const accessor = Object.defineProperty({}, "maxPages", { get() { assert.fail("never evaluate getters"); } });
  for (const input of [null, undefined, true, 0, "", [], new Array(2), new Date(), Object.create(null), accessor,
    new Proxy({}, { getPrototypeOf() { throw new Error("hostile"); } }), { extra: true }, { [Symbol("key")]: 1 }, { mode: "constructor" }]) {
    assert.equal(parseConsumerRequest(input), undefined);
  }
  const fields = ["pageSize", "pageTokens", "tokenBudget", "maxPages"];
  for (const key of fields) for (const value of [undefined, null, "1", NaN, Infinity, -Infinity, -1, 0, 0.5, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER]) {
    assert.equal(parseConsumerRequest({ [key]: value }), undefined);
  }
  for (const [key, min, max] of [["pageSize", 1, 128], ["pageTokens", 256, 8192], ["tokenBudget", 256, 10000000], ["maxPages", 1, 16]] as const) {
    assert.ok(parseConsumerRequest({ [key]: min })); assert.ok(parseConsumerRequest({ [key]: max }));
    assert.equal(parseConsumerRequest({ [key]: min - 1 }), undefined); assert.equal(parseConsumerRequest({ [key]: max + 1 }), undefined);
  }
  for (const bad of [null, {}, { ...checkpoint, extra: 1 }, { ...checkpoint, version: 2 }, { ...checkpoint, source: "wrong" },
    { ...checkpoint, mode: "foreign" }, { ...checkpoint, done: 1 }, { ...checkpoint, last_id: null },
    { ...checkpoint, after: "x" }, { ...checkpoint, output_cursor: "x" }, { ...checkpoint, last_id: "x".repeat(513) },
    { ...checkpoint, mode: "output", done: false, after: "x" }]) assert.equal(parseConsumerRequest({ checkpoint: bad }), undefined);
  for (const key of ["page_size", "page_tokens", "token_budget", "spent_tokens", "admitted", "pages"]) {
    for (const value of [NaN, Infinity, -1, 0.5, 1000000001]) assert.equal(parseConsumerRequest({ checkpoint: { ...checkpoint, [key]: value } }), undefined);
  }
  for (const key of ["after", "output_cursor"]) for (const value of [0, "", "x".repeat(4097)]) {
    assert.equal(parseConsumerRequest({ checkpoint: { ...checkpoint, done: false, [key]: value } }), undefined);
  }
  for (const overrides of [{ mode: "output" }, { pageSize: 1 }, { pageTokens: 1000 }, { tokenBudget: 256 }]) assert.equal(parseConsumerRequest({ checkpoint, ...overrides }), undefined);
  assert.ok(parseConsumerRequest({ checkpoint, mode: "producer", pageSize: 16, pageTokens: 2048, tokenBudget: 16000 }));
});

test("producer-output agreement refuses each corrupt native response alone, with finite bounded receipts", async (t) => {
  const { host } = await tracker(t, 4);
  const faults: Array<(page: Record<string, unknown>) => void> = [
    (p) => { delete p.read_session; },
    (p) => { (p.read_session as Record<string, unknown>).spent_before_tokens = 99; },
    (p) => { (p.read_session as Record<string, unknown>).token_budget = 1; },
    (p) => { (p.read_session as Record<string, unknown>).spent_total_tokens = Infinity; },
    (p) => { (p.read_session as Record<string, unknown>).charged_this_call_tokens = NaN; },
    (p) => { (p.read_session as Record<string, unknown>).spent_total_tokens = 0; },
    (p) => { p.items = null; }, (p) => { p.items = Array(4097).fill({ id: "one" }); },
    (p) => { p.completeness = { status: "partial" }; }, (p) => { p.items = new Array(1); },
    (p) => { p.items = [null]; }, (p) => { p.items = [{}]; }, (p) => { p.items = [{ id: "" }]; },
    (p) => { p.items = [{ id: "same" }, { id: "same" }]; }, (p) => { p.next_cursor = null; },
    (p) => { p.items = []; }, (p) => { p.next_cursor = ""; },
    (p) => { p.has_more = false; }, (p) => { p.next_cursor = "x".repeat(4097); },
    (p) => { delete p.has_more; },
  ];
  for (const mutate of faults) {
    const result = await consumePaginated(faultHost(host, mutate), { pageSize: 2, maxPages: 1 });
    assert.ok(!result.ok && result.code === "contract_unavailable", JSON.stringify(result));
    assert.equal(result.checkpoint?.admitted, 0);
    assert.ok(parseConsumerRequest({ checkpoint: success(await consumePaginated(host, { maxPages: 1 })).checkpoint }));
  }
  const overflow = success(await consumePaginated(host, { pageSize: 2, maxPages: 1 })).checkpoint;
  const refused = await consumePaginated(host, { checkpoint: { ...overflow, admitted: 1000000000 }, maxPages: 1 });
  assert.ok(!refused.ok && refused.code === "contract_unavailable");
  const nonadvancing = await consumePaginated(faultHost(host, (p) => { p.next_cursor = overflow.after; }), { checkpoint: overflow, maxPages: 1 });
  assert.ok(!nonadvancing.ok && nonadvancing.code === "contract_unavailable");
  const omitted = await consumePaginated(faultHost(host, (p) => {
    p.output_budget_exceeded = { omitted_result: true, reason: "requested_budget_infeasible", recovery: { outputBudget: "unbounded" } };
    delete p.items;
  }));
  assert.ok(!omitted.ok && omitted.code === "budget_insufficient");
  assert.equal(omitted.checkpoint?.admitted, 0); assert.ok(omitted.checkpoint && omitted.checkpoint.spent_tokens > 0);
});

test("500 seeded operation sequences compare SDK-read native state and reference admission through old checkpoint replays", async (t) => {
  const { host, client, pmRoot, directory } = await tracker(t);
  const native = (await client.listAllComplete({ includeBody: true })).items;
  const model = (await client.list({ status: "all", fields: "id", sort: "created_at", order: "asc", noTruncate: true })).items.map(({ id }) => id);
  const durable = fingerprint(pmRoot); process.env.PATH = directory;
  let seed = 0xcace1129;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const old: ConsumerCheckpoint[] = [];
  for (let sequence = 0; sequence < 500; sequence++) {
    const previous = old.length > 0 && next() % 2 === 0 ? old[next() % old.length] : undefined;
    const checkpoint: ConsumerCheckpoint | undefined = previous === undefined ? undefined
      : JSON.parse(` \r\n${JSON.stringify(previous, null, next() % 2 === 0 ? 2 : undefined).replaceAll("\n", "\r\n")}\t `);
    const controller = new AbortController(); const observed: string[] = [];
    const cancelAfter = next() % 3;
    if (cancelAfter === 0) controller.abort();
    let pages = 0;
    const request = checkpoint ? { checkpoint, maxPages: 1 + next() % 3 } : { pageSize: 1 + next() % 5, maxPages: 1 + next() % 3 };
    const result = success(await consumePaginated(host, request, { signal: controller.signal,
      onPage(ids) { observed.push(...ids); if (++pages === cancelAfter) controller.abort(); } }));
    assert.deepEqual(observed, model.slice(checkpoint?.admitted ?? 0, result.checkpoint.admitted), `seed=cace1129 sequence=${sequence}`);
    assert.equal(observed.length, new Set(observed).size);
    assert.ok(parseConsumerRequest({ checkpoint: JSON.parse(JSON.stringify(result.checkpoint)) }));
    old.push(result.checkpoint);
    assert.deepEqual((await client.listAllComplete({ includeBody: true })).items, native);
  }
  assert.equal(fingerprint(pmRoot), durable);
});

test("peer snapshot changes at every read/admission boundary refuse or report completed work truthfully", async (t) => {
  const { host, client } = await tracker(t, 20, true);
  let steps = 0;
  success(await consumePaginated(faultHost(host, () => { steps++; }), { mode: "output", pageTokens: 1400, maxPages: 16, tokenBudget: 100000 }));
  for (const phase of ["before", "after"]) for (let boundary = 1; boundary <= steps; boundary++) {
    let calls = 0; const admitted: string[] = [];
    const observed: ConsumerHost = { ...host, client: { async list<Options extends ListOptions & PmReadOutputOptions>(options?: Options) {
      calls++;
      const transition = async () => { await client.create({ type: "Task", title: `Foreign transition ${phase} ${boundary}`, parent: "none", goal: "none", objective: "none", sprint: "none", release: "none" }); };
      if (calls === boundary && phase === "before") await transition();
      const page = await client.list(options);
      if (calls === boundary && phase === "after") await transition();
      return page;
    } } };
    const result = await consumePaginated(observed, { mode: "output", pageTokens: 1400, maxPages: 16, tokenBudget: 100000 }, { onPage(ids) { admitted.push(...ids); } });
    assert.equal(new Set(admitted).size, admitted.length);
    if (result.ok) assert.equal(result.stop, "complete");
    else assert.equal(result.code, "cursor_rejected", JSON.stringify(result));
    if ((phase === "before" && boundary > 1) || (phase === "after" && boundary < steps)) {
      assert.ok(!result.ok && result.code === "cursor_rejected", "a peer changed an already-started snapshot before its next native read");
    }
    assert.ok(calls >= boundary);
  }
});

test("installed CLI outputs compact JSON/TOON and rejects malformed guards without git", async (t) => {
  const { directory, pmRoot } = await tracker(t, 5);
  const root = resolve(import.meta.dirname, ".."); const cli = join(root, "node_modules/@unbrained/pm-cli/dist/cli.js");
  const install = spawnSync(process.execPath, [cli, "--path", pmRoot, "extension", "install", root], { cwd: directory, encoding: "utf8" });
  assert.equal(install.status, 0, install.stderr);
  symlinkSync(process.execPath, join(directory, "node"));
  const childEnv = { ...process.env, PATH: directory, GIT_CEILING_DIRECTORIES: dirname(directory) };
  const before = fingerprint(pmRoot);
  for (const format of ["json", "toon"]) {
    const result = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "consume", "--page-size", "2", "--max-pages", "2", "--output-format", format], { cwd: directory, env: childEnv, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.ok(Buffer.byteLength(result.stdout) < 2000);
    if (format === "json") assert.equal(JSON.parse(result.stdout).checkpoint.admitted, 4); else assert.match(result.stdout, /page_limit/);
  }
  for (const guard of ["0", "-1", "NaN", "1.5", "", "999999999999999"]) {
    const result = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "consume", "--max-pages", guard, "--json"], { cwd: directory, env: childEnv, encoding: "utf8" });
    assert.equal(result.status, 2, result.stderr); assert.equal(JSON.parse(result.stdout).code, "invalid_request");
  }
  const first = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "consume", "--page-size", "2", "--max-pages", "2", "--json"], { cwd: directory, env: childEnv, encoding: "utf8" });
  const checkpoint = JSON.parse(first.stdout).checkpoint;
  const resumed = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "consume", "--checkpoint", JSON.stringify(checkpoint), "--json"], { cwd: directory, env: childEnv, encoding: "utf8" });
  assert.equal(resumed.status, 0, resumed.stderr); assert.equal(JSON.parse(resumed.stdout).checkpoint.admitted, 5);
  assert.equal(fingerprint(pmRoot), before);
});

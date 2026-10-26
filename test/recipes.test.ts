import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import type { GetOptions, PmReadOutputOptions } from "@unbrained/pm-cli/sdk/core";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import extension from "../index.ts";
import {
  assertInsufficientBudgetRecovery, assertMissingItemRecovery, assertUnsupportedCapabilityRecovery,
  captureReadRefusal, failureFirstItemCount, FailureFirstContractError, parseFailureFirstRequest, runFailureFirstCommand, runFailureFirstRecipes,
} from "../recipes.ts";

/** Fingerprint authoritative source and history while excluding host-derived caches. */
function fingerprint(root: string): string {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .filter((entry) => !["runtime", "locks", "search", "extensions"].includes(entry.name))
    .map((entry) => `${entry.name}:${entry.isDirectory() ? fingerprint(join(root, entry.name))
      : createHash("sha256").update(readFileSync(join(root, entry.name))).digest("hex")}`).join("\n");
}

/** Real native tracker with no enclosing git repository; cleanup never touches an existing tracker. */
async function tracker(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "starter-recipes-"));
  const savedPath = process.env.PATH;
  const savedCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = dirname(directory);
  t.after(() => {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    if (savedCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
    rmSync(directory, { recursive: true, force: true });
  });
  const pmRoot = join(directory, ".agents/pm");
  const client = new PmClient({ pmRoot, noExtensions: true, author: "recipe-test" });
  await client.init("recipe", { defaults: true, mergeFence: false, agentGuidance: "skip" });
  return { directory, pmRoot, client, sdk: createExtensionCommandSdk(pmRoot, client) };
}

/** Real extension dispatcher grants the package's existing manifest capabilities. */
function harness() {
  return createExtensionTestHarness(extension, { capabilities: ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] });
}

/** Record real native calls and outcomes without replacing SDK responses or refusal generation. */
function recordingClient(client: PmClient) {
  const trace: string[] = [];
  const observed = new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          const result: unknown = await Reflect.apply(value, target, args);
          trace.push(`${String(property)}:ok`);
          return result;
        } catch (error) {
          trace.push(`${String(property)}:refused`);
          throw error;
        }
      };
    },
  });
  return { client: observed, trace };
}

test("all three recipes consume native contracts and finish reads without git, pm or tracker mutations", async (t) => {
  const { directory, pmRoot, client, sdk } = await tracker(t);
  await client.create({ id: "starter-recipe-absent", title: "Collision is a real item", type: "Task" });
  await client.create({ title: "Closed item", type: "Task", status: "closed", closeReason: "Native lifecycle evidence" });
  assert.equal(await captureReadRefusal(() => client.get("starter-recipe-absent")), undefined);
  const before = fingerprint(pmRoot);
  process.env.PATH = directory;
  const recorded = recordingClient(client);
  const result = await runFailureFirstRecipes({ ...sdk, client: recorded.client });
  assert.deepEqual(recorded.trace, ["listAllComplete:ok", "get:refused", "listAllComplete:ok", "get:ok", "run:refused", "graph:ok", "list:ok", "listAllComplete:ok"]);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.item_count, 2);
  assert.deepEqual(result.recipes.map(({ code, remedy, recovered }) => ({ code, remedy, recovered })), [
    { code: "item_not_found", remedy: "discover_existing_id", recovered: true },
    { code: "unknown_subcommand", remedy: "choose_allowed_read", recovered: true },
    { code: "requested_budget_infeasible", remedy: "use_advertised_budget", recovered: true },
  ]);
  assert.deepEqual(await runFailureFirstRecipes(sdk, { recipe: "all" }), result);
  assert.equal(fingerprint(pmRoot), before);
  const ext = await harness();
  const preflight = await ext.runPreflightOverride({ command: "starter recover", args: [], options: {}, global: {}, pm_root: pmRoot,
    decision: { enforce_item_format_gate: true, run_preflight_item_format_sync: false, run_extension_migrations: true, enforce_mandatory_migration_gate: false } });
  assert.equal(preflight.decision.run_extension_migrations, false);
  const command = await ext.runCommand({ command: "starter recover", options: {}, pmRoot, sdk });
  assert.deepEqual(command.result, result);
  const single = await runFailureFirstCommand({ options: { recipe: "insufficient-budget" }, sdk });
  assert.ok(single.ok && single.recipes.length === 1);
  const invalid = await ext.runCommand({ command: "starter recover", options: { recipe: "write" }, pmRoot, sdk });
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.errorCode, "invalid_request");
  const unavailable = await runFailureFirstCommand({ options: {} });
  assert.ok(!unavailable.ok && unavailable.code === "sdk_unavailable");
  assert.equal(fingerprint(pmRoot), before);
});

test("empty, unavailable and changed real sources fail explicitly without fabricating recovery", async (t) => {
  const { client, sdk, pmRoot, directory } = await tracker(t);
  assert.deepEqual((await runFailureFirstRecipes(sdk)).ok, false);
  await client.create({ id: "recipe-one", type: "Task", title: "One" });
  const unavailableRoot = join(directory, "uninitialized");
  const unavailable = createExtensionCommandSdk(unavailableRoot, new PmClient({ pmRoot: unavailableRoot, noExtensions: true }));
  const sourceFailure = await runFailureFirstRecipes(unavailable);
  assert.ok(!sourceFailure.ok && sourceFailure.code === "source_unavailable");
  // Inject actual peer transitions before every SDK call of the missing-item path.
  // Delegates still execute the native SDK; no backend response is mocked.
  for (let boundary = 1; boundary <= 4; boundary++) {
    const peerRoot = join(directory, `peer-${boundary}`);
    const reader = new PmClient({ pmRoot: peerRoot, noExtensions: true, author: "reader" });
    const peer = new PmClient({ pmRoot: peerRoot, noExtensions: true, author: "peer" });
    await peer.init("peer", { defaults: true, mergeFence: false, agentGuidance: "skip" });
    await peer.create({ id: "peer-one", type: "Task", title: "Foreign item" });
    let step = 0;
    const transition = async () => {
      if (++step === boundary) {
        if (boundary === 2) await peer.create({ id: "peer-onex", type: "Task", title: "Peer fulfilled the missing lookup" });
        else await peer.delete("peer-one");
      }
    };
    const host = createExtensionCommandSdk(peerRoot, reader);
    const observed = { ...host, client: { ...host.client,
      async listAllComplete() { await transition(); return reader.listAllComplete(); },
      async get<Options extends GetOptions & PmReadOutputOptions>(id: string, options?: Options) { await transition(); return reader.get<Options>(id, options); },
      list: reader.list.bind(reader), graph: reader.graph.bind(reader), run: reader.run.bind(reader),
    } };
    const result = await runFailureFirstRecipes(observed, { recipe: "missing-item" });
    assert.equal(result.ok, false);
    if (boundary === 2) assert.ok(!result.ok && result.code === "recovery_contract_unavailable");
    const state = await peer.listAllComplete();
    assert.equal(state.items.length, boundary === 2 ? 2 : 0);
  }
  assert.equal((await client.get("recipe-one")).item.id, "recipe-one");
  assert.ok(!JSON.stringify(sourceFailure).includes(pmRoot));
});

test("one strict request schema rejects sparse arrays, accessors, exotic objects and numeric extremes", () => {
  assert.deepEqual(parseFailureFirstRequest({}), {});
  for (const recipe of ["all", "missing-item", "unsupported-capability", "insufficient-budget"]) assert.deepEqual(parseFailureFirstRequest({ recipe }), { recipe });
  const getter = Object.defineProperty({}, "recipe", { get() { assert.fail("must not evaluate untrusted getters"); } });
  for (const value of [undefined, null, false, 1, "all", [], new Array(5), new Date(), Object.create(null), getter, new Proxy({}, { getPrototypeOf() { throw new Error("hostile input"); } }),
    { recipe: undefined }, { extra: true }, { [Symbol("extra")]: true }, { recipe: "x".repeat(100000) },
    ...[Infinity, -Infinity, NaN, -1, 0, Number.MAX_VALUE, Number.MIN_VALUE, 1.5].map((recipe) => ({ recipe }))]) {
    assert.equal(parseFailureFirstRequest(value), undefined);
  }
});

test("native contract boundary fuzzing rejects malformed remedies and nonfinite emitted counts", () => {
  assertMissingItemRecovery({ context: { nextSteps: ["opaque producer prose"] } }, true);
  for (const [error, classified] of [[null, false], [{}, true], [{ context: { nextSteps: [] } }, true], [{ context: { nextSteps: "retry" } }, true]] as const) {
    assert.throws(() => assertMissingItemRecovery(error, classified), FailureFirstContractError);
  }
  assertUnsupportedCapabilityRecovery({ context: { code: "unknown_subcommand", recovery: { allowed_values: ["ancestors"] } } });
  for (const allowed of [undefined, null, {}, [], new Array(2), ["ancestors", , "audit"], ["ancestors", 1], ["index"], ["ancestors", "x".repeat(33)], Array(65).fill("ancestors")]) {
    assert.throws(() => assertUnsupportedCapabilityRecovery({ context: { code: "unknown_subcommand", recovery: { allowed_values: allowed } } }), FailureFirstContractError);
  }
  for (const value of [undefined, [], { context: { code: "foreign" } }, { context: { code: "unknown_subcommand" } }]) assert.throws(() => assertUnsupportedCapabilityRecovery(value), FailureFirstContractError);
  const good = { output_budget_exceeded: { omitted_result: true, reason: "requested_budget_infeasible", recovery: { outputBudget: "unbounded" } } };
  assertInsufficientBudgetRecovery(good);
  for (const value of [undefined, {}, { output_budget_exceeded: { omitted_result: false } },
    { output_budget_exceeded: { omitted_result: true, reason: "foreign" } },
    { output_budget_exceeded: { omitted_result: true, reason: "requested_budget_infeasible", recovery: { outputBudget: Infinity } } }]) {
    assert.throws(() => assertInsufficientBudgetRecovery(value), FailureFirstContractError);
  }
  for (const count of [Infinity, -Infinity, NaN, -1, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1, 0.5, 1]) {
    assert.throws(() => failureFirstItemCount({ complete_list: { item_count: count } as Parameters<typeof failureFirstItemCount>[0]["complete_list"], items: [] }), FailureFirstContractError);
  }
  assert.equal(failureFirstItemCount({ complete_list: { item_count: 0 } as Parameters<typeof failureFirstItemCount>[0]["complete_list"], items: [] }), 0);
});

test("packaged JSON and TOON commands recover in a non-git tracker with no git executable", async (t) => {
  const { directory, pmRoot, client } = await tracker(t);
  await client.create({ type: "Task", title: "Native CLI recovery" });
  const root = resolve(import.meta.dirname, "..");
  const cli = join(root, "node_modules/@unbrained/pm-cli/dist/cli.js");
  const installed = spawnSync(process.execPath, [cli, "--path", pmRoot, "extension", "install", root], { cwd: directory, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  symlinkSync(process.execPath, join(directory, "node"));
  const env = { ...process.env, PATH: directory, GIT_CEILING_DIRECTORIES: dirname(directory) };
  const before = fingerprint(pmRoot);
  const nativeMissing = spawnSync(process.execPath, [cli, "--path", pmRoot, "--no-extensions", "get", "recipe-absent", "--json"], { cwd: directory, env, encoding: "utf8" });
  assert.equal(nativeMissing.status, 3);
  assert.equal(nativeMissing.stdout, "");
  const nativeContract = JSON.parse(nativeMissing.stderr) as { code: string; required: string; recovery: object };
  assert.equal(nativeContract.code, "item_not_found");
  assert.ok(nativeContract.required.length > 0);
  assert.ok(nativeContract.recovery);
  for (const format of ["json", "toon"]) {
    const command = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "recover", "--output-format", format], { cwd: directory, env, encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    assert.ok(Buffer.byteLength(command.stdout) < 1600);
    if (format === "json") assert.ok(JSON.parse(command.stdout).ok);
    else assert.match(command.stdout, /recovered/);
  }
  const invalid = spawnSync(process.execPath, [cli, "--path", pmRoot, "starter", "recover", "--recipe", "write", "--json"], { cwd: directory, env, encoding: "utf8" });
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).code, "invalid_request");
  assert.equal(fingerprint(pmRoot), before);
});

test("500 seeded model-based operation sequences preserve SDK-read state, including old request replays", async (t) => {
  const { directory, pmRoot, client, sdk } = await tracker(t);
  let seed = 0x51f17e;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const roles = [["active"], ["draft"], ["blocked"], ["terminal", "terminal_done"], ["terminal", "terminal_canceled"]];
  // Random registry names ensure recipe behavior never relies on lifecycle names.
  for (let index = 0; index < roles.length; index++) {
    const status = `custom_${next().toString(16)}`;
    await client.schemaAddStatus(status, { role: roles[index] });
    await client.create({ id: `recipe-seed-${index}`, type: "Task", title: `  Native title ${index}  `,
      status, closeReason: "Seeded native state", description: ` description ${index} \r\n second line `,
      body: `  body ${next()}\r\n\n preserved whitespace  `, priority: index,
      tags: "recipe,reference", dep: index === 0 ? [] : ["id=recipe-seed-0,kind=related"],
      comment: ["text=Native comment"], note: ["text=Native note"], learning: ["text=Native learning"],
      file: ["path=recipes.ts,scope=project"], doc: ["path=README.md,scope=project"], test: ["command=node --version,scope=project"] });
  }
  // The model stores canonical SDK state; it performs no handwritten field normalization.
  const reference = (await client.listAllComplete({ includeBody: true })).items;
  const durable = fingerprint(pmRoot);
  process.env.PATH = directory;
  const requests: Array<{ recipe?: "missing-item" | "unsupported-capability" | "insufficient-budget" }> = [{}, { recipe: "missing-item" }, { recipe: "unsupported-capability" }, { recipe: "insufficient-budget" }];
  for (let sequence = 0; sequence < 500; sequence++) {
    // Each sequence is a fresh request, a historical replay and an authoritative state read.
    const request = requests[next() % requests.length];
    const result = await runFailureFirstRecipes(sdk, request);
    assert.ok(result.ok, `seed=0x51f17e sequence=${sequence}: ${JSON.stringify(result)}`);
    assert.equal(result.item_count, reference.length);
    const replay = await runFailureFirstRecipes(sdk, requests[(next() >>> 8) % requests.length]);
    assert.ok(replay.ok);
    assert.deepEqual((await client.listAllComplete({ includeBody: true })).items, reference, `state sequence=${sequence}`);
  }
  assert.equal(fingerprint(pmRoot), durable);
});

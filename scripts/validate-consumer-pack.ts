/** Test one captured tarball with npm/Bun global, npx/bunx and project-local hosts. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { devNull, tmpdir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PmClient } from "@unbrained/pm-cli/sdk";

const root = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "starter-pack-consumer-"));
// Explicit child allowlist: no inherited registry, provider, git or service credentials.
const childEnv = {
  PATH: process.env.PATH, HOME: join(directory, "home"), TMPDIR: join(directory, "tmp"),
  GIT_CEILING_DIRECTORIES: dirname(directory), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1",
  NPM_CONFIG_USERCONFIG: devNull, npm_config_userconfig: devNull, NPM_CONFIG_CACHE: join(directory, "npm-cache"),
  NPM_CONFIG_IGNORE_SCRIPTS: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false",
  BUN_INSTALL: join(directory, "bun"), BUN_INSTALL_GLOBAL_DIR: join(directory, "bun-global"),
  BUN_INSTALL_BIN: join(directory, "bun-bin"), BUN_INSTALL_CACHE_DIR: join(directory, "bun-cache"),
  PM_AUTHOR: "consumer-pack-test", NO_COLOR: "1",
};
for (const name of ["home", "tmp"]) mkdirSync(join(directory, name));

/** Execute a known package-manager or host command without a shell or inherited credentials. */
function run(command: string, args: readonly string[], cwd = directory): string {
  const result = spawnSync(command, [...args], { cwd, env: childEnv, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`); return result.stdout;
}

/** Bind every acceptance invocation to exactly the previously captured artifact bytes. */
function digest(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

try {
  const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], root)) as Array<{ filename: string; files: Array<{ path: string }> }>;
  assert.equal(packed.length, 1);
  const artifact = join(root, packed[0].filename); const sha256 = digest(artifact);
  for (const expected of ["dist/paginated-consumer.js", "dist/paginated-consumer.d.ts", "docs/cancellation-safe-consumer.md"]) {
    assert.ok(packed[0].files.some(({ path }) => path === expected));
  }
  const unpacked = join(directory, "unpacked"); mkdirSync(unpacked);
  run("tar", ["-xzf", artifact, "-C", unpacked]);
  const cliPackage = "@unbrained/pm-cli@2026.10.28";
  const receipts: Array<{ route: string; admitted: number; resumed: number; json_bytes: number; toon_bytes: number }> = [];

  /** Exercise the installed host entrypoint and the exact packed extension in a real non-git tracker. */
  async function accept(route: string, executable: string, prefix: readonly string[], extensionPath: string): Promise<void> {
    assert.equal(digest(artifact), sha256);
    const cwd = join(directory, route); mkdirSync(cwd, { recursive: true });
    const pmRoot = join(cwd, ".agents/pm");
    const client = new PmClient({ pmRoot, author: "consumer-pack-test", noExtensions: true });
    await client.init("pack", { defaults: true, mergeFence: false, agentGuidance: "skip" });
    for (let index = 0; index < 5; index++) await client.create({ type: "Task", title: `Packed synthetic ${index}`,
      parent: "none", goal: "none", objective: "none", sprint: "none", release: "none" });
    const state = (await client.listAllComplete({ includeBody: true })).items;
    run(executable, [...prefix, "--path", pmRoot, "extension", "install", extensionPath], cwd);
    const first = run(executable, [...prefix, "--path", pmRoot, "starter", "consume", "--page-size", "2", "--max-pages", "2", "--json"], cwd);
    const receipt = JSON.parse(first) as { ok: boolean; checkpoint: { admitted: number } };
    assert.equal(receipt.ok, true); assert.equal(receipt.checkpoint.admitted, 4);
    const resumed = JSON.parse(run(executable, [...prefix, "--path", pmRoot, "starter", "consume", "--checkpoint", JSON.stringify(receipt.checkpoint), "--json"], cwd)) as { stop: string; admitted_this_call: number };
    assert.equal(resumed.stop, "complete"); assert.equal(resumed.admitted_this_call, 1);
    const toon = run(executable, [...prefix, "--path", pmRoot, "starter", "consume", "--page-size", "2", "--max-pages", "2", "--output-format", "toon"], cwd);
    assert.match(toon, /page_limit/);
    assert.deepEqual((await client.listAllComplete({ includeBody: true })).items, state);
    receipts.push({ route, admitted: 4, resumed: 1, json_bytes: Buffer.byteLength(first), toon_bytes: Buffer.byteLength(toon) });
    console.log(JSON.stringify({ route, passed: true }));
  }

  const npmGlobal = join(directory, "npm-global");
  run("npm", ["install", "--global", "--prefix", npmGlobal, "--ignore-scripts", cliPackage, artifact]);
  await accept("npm-global", join(npmGlobal, "bin/pm"), [], join(npmGlobal, "lib/node_modules/pm-starter"));

  mkdirSync(childEnv.BUN_INSTALL_GLOBAL_DIR, { recursive: true });
  writeFileSync(join(childEnv.BUN_INSTALL_GLOBAL_DIR, "package.json"), '{"name":"isolated-global","private":true}');
  const bunBin = run("bun", ["pm", "bin", "--global"]).trim();
  assert.equal(bunBin, childEnv.BUN_INSTALL_BIN, "Bun global install must be isolated before any mutation");
  run("bun", ["install", "--global", "--ignore-scripts", cliPackage, artifact]);
  const bunExtension = join(childEnv.BUN_INSTALL_GLOBAL_DIR, "node_modules/pm-starter"); assert.ok(existsSync(bunExtension));
  await accept("bun-global", join(bunBin, "pm"), [], bunExtension);

  await accept("npx", "npm", ["exec", "--yes", "--package", cliPackage, "--package", artifact, "--", "pm"], join(unpacked, "package"));
  await accept("bunx", "bun", ["x", "--package", cliPackage, "pm"], join(unpacked, "package"));

  const local = join(directory, "project"); mkdirSync(local);
  run("npm", ["install", "--prefix", local, "--ignore-scripts", cliPackage, artifact]);
  await accept("project-local", join(local, "node_modules/.bin/pm"), [], join(local, "node_modules/pm-starter"));
  assert.equal(digest(artifact), sha256);
  console.log(JSON.stringify({ artifact: packed[0].filename, sha256, host: "2026.10.28", routes: receipts.length, receipts }));
} finally { rmSync(directory, { recursive: true, force: true }); }

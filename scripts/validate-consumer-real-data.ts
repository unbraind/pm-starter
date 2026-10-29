/** Validate read-only consumption against the public main tracker copied outside git. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { consumePaginated, type ConsumerResult } from "../paginated-consumer.ts";

/** Freeze only source files and their existing directories; native caches may use new directories. */
function freeze(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) { freeze(path); chmodSync(path, 0o555); } else chmodSync(path, 0o444);
  }
}

/** Hash authoritative public tracker files and measure their byte count without derived caches. */
function corpus(root: string): { digest: string; files: number; bytes: number } {
  const hash = createHash("sha256"); let files = 0; let bytes = 0;
  /** Traverse only the explicit public tracker copy. */
  function visit(path: string, relative: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (["runtime", "locks", "search", "extensions"].includes(entry.name)) continue;
      const name = join(relative, entry.name); const target = join(path, entry.name);
      if (entry.isDirectory()) visit(target, name);
      else { const content = readFileSync(target); hash.update(name).update(content); files++; bytes += content.length; }
    }
  }
  visit(root, ""); return { digest: hash.digest("hex"), files, bytes };
}

/** Require a completed native contract instead of accepting a partial validation receipt. */
function success(result: ConsumerResult): Extract<ConsumerResult, { ok: true }> {
  assert.ok(result.ok, JSON.stringify(result)); return result;
}

const root = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "starter-public-consumer-"));
const ceiling = process.env.GIT_CEILING_DIRECTORIES;
const originalPath = process.env.PATH;
try {
  const archive = execFileSync("git", ["archive", "origin/main", ".agents/pm"], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", directory], { input: archive });
  const sourceHead = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
  const pmRoot = join(directory, ".agents/pm");
  freeze(pmRoot); mkdirSync(join(pmRoot, "runtime"), { recursive: true }); mkdirSync(join(pmRoot, "locks"), { recursive: true });
  process.env.GIT_CEILING_DIRECTORIES = dirname(directory); process.env.PATH = directory;
  const client = new PmClient({ pmRoot, noExtensions: true, author: "consumer-validation" });
  const before = await client.listAllComplete({ includeBody: true });
  const source = corpus(pmRoot); const ids: string[] = []; const controller = new AbortController();
  const host = { client, sourceKey: pmRoot };
  const first = success(await consumePaginated(host, { pageSize: 7, maxPages: 16, tokenBudget: 100000 }, {
    signal: controller.signal, onPage(rows, checkpoint) { ids.push(...rows); if (checkpoint.pages === 2) controller.abort(); },
  }));
  assert.equal(first.stop, "canceled"); assert.equal(first.checkpoint.admitted, 14);
  const resumed = success(await consumePaginated(host, { checkpoint: first.checkpoint, maxPages: 16 }, { onPage(rows) { ids.push(...rows); } }));
  assert.equal(resumed.stop, "complete"); assert.equal(ids.length, before.items.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), before.items.map(({ id }) => id).sort());
  const output = success(await consumePaginated(host, { mode: "output", pageTokens: 1400, tokenBudget: 100000, maxPages: 16 }));
  assert.equal(output.stop, "complete"); assert.equal(output.checkpoint.admitted, before.items.length);
  assert.deepEqual((await client.listAllComplete({ includeBody: true })).items, before.items);
  assert.deepEqual(corpus(pmRoot), source);
  console.log(JSON.stringify({ source: "unbraind/pm-starter", source_head: sourceHead, items: before.items.length,
    source_files: source.files, source_bytes: source.bytes, canceled_after_pages: first.checkpoint.pages,
    admitted_before_cancel: first.checkpoint.admitted, admitted_on_resume: resumed.admitted_this_call,
    total_pages: resumed.checkpoint.pages, unique_ids: new Set(ids).size,
    producer_host_tokens: resumed.checkpoint.spent_tokens, output_pages: output.checkpoint.pages,
    output_host_tokens: output.checkpoint.spent_tokens, canceled_receipt_json_bytes: Buffer.byteLength(JSON.stringify(first)),
    final_receipt_json_bytes: Buffer.byteLength(JSON.stringify(resumed)), authoritative_changes: 0, sdk_state_equal: true }));
} finally {
  if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceiling;
  if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
  /** Restore modes solely in this disposable copy so recursive cleanup works for unprivileged users. */
  function thaw(path: string): void {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) thaw(join(path, entry.name));
  }
  thaw(directory); rmSync(directory, { recursive: true, force: true });
}

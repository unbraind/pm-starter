/**
 * Convergence tests for the publish-attestation gate.
 *
 * This repository no longer implements the gate; it consumes the canonical
 * auditor from `pm-ops/attestation`. So these tests deliberately do NOT
 * re-test the shell model - that suite lives with the implementation, where a
 * fix reaches every consumer at once. What they assert instead is that this
 * repository is still a consumer: that the gate resolves to the package export
 * rather than to a local copy, and that it still refuses an unattested publish
 * through that resolved path.
 *
 * The first is the one that matters over time. Fifteen fail-open constructions
 * have been found in this gate, three of them introduced by the fix for an
 * earlier one, and a copy frozen at any point in that sequence still admits
 * every construction closed after it. A hand-edit that re-forks the lineage
 * would otherwise be invisible.
 *
 * The main-invocation guard is also exercised here because this repository no
 * longer carries a dedicated scanner test that covered it. Every branch of
 * {@link isMainInvocation} is reached so the 100% coverage gate stays green
 * after the scanner's test file was deleted.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { auditPublishAttestation, report, verify } from "pm-ops/attestation";

import { runIfMain } from "../scripts/verify-release-publish-attestation.ts";
import { isMainInvocation } from "../scripts/main-invocation.ts";

const root = resolve(import.meta.dirname, "..");

test("the gate is the resolved package export, not a local copy", async () => {
  // Identity, not similarity. A vendored copy that happens to behave the same
  // today is exactly what this fleet spent a session removing, because it stops
  // behaving the same the moment the canonical implementation is fixed again.
  assert.equal(
    existsSync(resolve(root, "scripts/shell-command-scan.ts")),
    false,
    "a local shell-command-scan.ts means the lineage has been re-forked",
  );

  const launcher = await readFile(resolve(root, "scripts/verify-release-publish-attestation.ts"), "utf-8");
  assert.match(launcher, /from "pm-ops\/attestation"/u, "the gate must import the canonical auditor");
  assert.doesNotMatch(
    launcher,
    /from "\.\/shell-command-scan/u,
    "the gate must not resolve any part of its shell model locally",
  );

  // The functions the launcher runs are the package's own, by reference.
  assert.equal(typeof verify, "function");
  assert.equal(typeof report, "function");
});

test("the resolved gate still refuses an unattested publish", () => {
  // A behavioural check through the real resolved module, so "it imports the
  // package" cannot pass while the package fails to load or changes shape.
  const workflow = (publish: string): string =>
    ["jobs:", "  release:", "    steps:", "      - run: |", `          ${publish}`].join("\n");

  const unattested = auditPublishAttestation([
    { file: ".github/workflows/release.yml", text: workflow("npm publish --access public") },
  ]);
  assert.equal(unattested.failures.length, 1);

  const attested = auditPublishAttestation([
    { file: ".github/workflows/release.yml", text: workflow("npm publish --access public --provenance") },
  ]);
  assert.deepEqual(attested.failures, []);
  assert.deepEqual(attested.recognition, { kind: "recognized", count: 1 });
});

test("this repository's own workflows pass the gate", () => {
  // The gate pointed at this checkout, which is what CI runs. Reported through
  // captured streams rather than the process ones so a failure is readable.
  const lines: string[] = [];
  let exitCode = 0;
  report(verify(root), (line) => lines.push(line), (code) => { exitCode = code; });
  assert.equal(exitCode, 0, `the gate must pass on this repository:\n${lines.join("\n")}`);
  assert.ok(lines.some((line) => line.includes("every publish invocation is attested")));
});

test("the launcher runs only as the process entry point", () => {
  // A bare `if` at module scope leaves its own body unreachable from any
  // in-process test, which is how an entry point quietly stops running.
  // A real path that is not this module: isMainInvocation resolves the argv
  // entry, so a nonexistent one throws rather than answering the question.
  assert.equal(runIfMain(["node", resolve(root, "package.json")], import.meta.url, root), false);
});

test("the launcher runs the gate and sets a failing exit code on an unattested publish when it is the entry point", () => {
  // The positive branch: argv[1] and moduleUrl both resolve to the launcher's
  // own path, so isMainInvocation answers true and runIfMain executes the gate
  // for real — writing to process.stdout and setting process.exitCode. Against
  // a fixture with an unattested publish, the gate must set exit code 1 and
  // return true. A regression that removes the `process.exitCode = code`
  // assignment from the launcher, or that makes isMainInvocation return false
  // for a real invocation, leaves the gate silently exiting 0 on an unattested
  // publish — exactly the failure this test's own comment warns about.
  const launcherPath = resolve(root, "scripts/verify-release-publish-attestation.ts");
  const launcherUrl = pathToFileURL(launcherPath).href;

  // A fixture repository with one unattested publish, tracked by git so
  // verify(root) — which calls `git ls-files` — discovers it.
  const fixture = mkdtempSync(resolve(tmpdir(), "pm-starter-attestation-fixture-"));
  try {
    mkdirSync(resolve(fixture, ".github/workflows"), { recursive: true });
    writeFileSync(
      resolve(fixture, ".github/workflows/release.yml"),
      ["jobs:", "  release:", "    steps:", "      - run: |", "          npm publish --access public"].join("\n") + "\n",
    );
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: fixture });
    execFileSync("git", ["add", ".github/workflows/release.yml"], { cwd: fixture });
    execFileSync(
      "git",
      ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", "fixture"],
      { cwd: fixture },
    );

    const savedExitCode = process.exitCode;
    try {
      const ran = runIfMain(["node", launcherPath], launcherUrl, fixture);
      assert.equal(ran, true, "the launcher must run the gate when it is the entry point");
      assert.equal(process.exitCode, 1, "an unattested publish must set a failing exit code");
    } finally {
      process.exitCode = savedExitCode;
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("the main-invocation guard answers both ways, including a missing argv entry", () => {
  // Every branch of isMainInvocation is exercised here because the scanner test
  // that previously covered it was deleted with the scanner. The three
  // outcomes are: a matching entry runs, a non-matching entry does not, and a
  // missing entry does not.
  const self = fileURLToPath(import.meta.resolve("../scripts/main-invocation.ts"));
  const url = import.meta.resolve("../scripts/main-invocation.ts");
  assert.equal(isMainInvocation(["node", self], url), true, "a matching entry is the main module");
  assert.equal(isMainInvocation(["node", fileURLToPath(import.meta.url)], url), false, "a different entry is not main");
  assert.equal(isMainInvocation(["node"], url), false, "a missing argv[1] is not main");
});

test("the main-invocation guard throws when argv[1] cannot be resolved", () => {
  // An unresolvable entry propagates rather than returning false, because a
  // false return means a release gate exits 0 having scanned nothing. A broken
  // environment must not silently satisfy a gate.
  assert.throws(
    () => isMainInvocation(["node", resolve(root, "does-not-exist.ts")], import.meta.resolve("../scripts/main-invocation.ts")),
  );
});
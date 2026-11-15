/** Execute the path classifier and keep CI tiers honest for new starter clones. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import test from "node:test";
import { parseDocument } from "yaml";

interface Step { name?: string; run?: string; uses?: string; if?: string }
interface Workflow {
  on: Record<string, { paths?: string[] }>;
  jobs: Record<string, { "runs-on": string; "timeout-minutes": number; steps: Step[]; strategy?: { matrix: Record<string, unknown> } }>;
}

/** Strict parsing rejects duplicate keys and malformed workflows. */
function workflow(path: string): Workflow {
  const parsed = parseDocument(readFileSync(new URL("../" + path, import.meta.url), "utf8"), { strict: true, uniqueKeys: true });
  assert.deepEqual(parsed.errors, [], path);
  assert.deepEqual(parsed.warnings, [], path);
  return parsed.toJS() as Workflow;
}

const ci = workflow(".github/workflows/ci.yml");

test("documentation and tracker changes retain health, privacy and input checks", () => {
  const steps = ci.jobs.test.steps;
  assert.ok(steps.some(step => step.run?.includes("pm health --strict-exit --require-merge-drivers")));
  const docs = steps.find(step => step.name === "Check documentation and tracker changes");
  assert.equal(docs?.if, "steps.changes.outputs.code != 'true'");
  for (const command of ["npm run changelog:check", "test/identity-audit.test.ts", "test/sdk-floor.test.ts"]) assert.ok(docs?.run?.includes(command), command);
});

test("NUL-delimited classifier keeps docs cheap and executable tracker files in the code tier", { skip: process.platform === "win32" && "The workflow classifier runs in Ubuntu Bash" }, t => {
  const root = mkdtempSync(join(tmpdir(), "ci-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = ci.jobs.test.steps.find(step => step.name === "Detect code changes")?.run;
  assert.ok(script);
  // A tiny git shim emits the exact diff protocol without depending on a remote.
  const git = join(root, "git");
  writeFileSync(git, '#!/bin/sh\ncat "$CI_PATH_INPUT"\n', { mode: 0o755 });
  for (const [paths, expected] of [
    [["README.md", "docs/example.json", ".agents/pm/tasks/example.toon"], false],
    [[".agents/pm/nested/check.ts"], true], [[".agents/pm/check.mjs"], true],
    [["docs/line\nbreak.md", "index.ts"], true], [["old-source.ts", "docs/moved.md"], true],
  ] as const) {
    writeFileSync(join(root, "input"), paths.join("\0") + "\0");
    writeFileSync(join(root, "output"), "");
    execFileSync("/bin/bash", ["-c", script], { env: { ...process.env, PATH: root + ":" + process.env.PATH,
      GITHUB_EVENT_NAME: "pull_request", BASE_SHA: "base", HEAD_SHA: "head", RUNNER_TEMP: root,
      CI_PATH_INPUT: join(root, "input"), GITHUB_OUTPUT: join(root, "output") } });
    assert.equal(readFileSync(join(root, "output"), "utf8"), `code=${expected}\n`);
  }
});

test("deep defaults to hosted runners and separates full installer graphs", () => {
  for (const path of [".github/workflows/ci-deep.yml"]) {
    const deep = workflow(path).jobs.deep;
    assert.equal(deep["runs-on"], "${{ vars.PM_LOCAL_DEEP == 'on' && fromJSON('[\"self-hosted\",\"pm-local\"]') || 'ubuntu-latest' }}");
    assert.deepEqual(deep.strategy?.matrix, { "node-version": [22, 26], runtime: ["npm", "bun"] });
    assert.equal(deep["timeout-minutes"], 120);
    const gates = deep.steps.filter(step => step.run === "npm run release:check" || step.run === "bun run release:check");
    assert.equal(gates.length, 2);
    for (const gate of gates) assert.ok(gate.if?.includes(`matrix.runtime == '${gate.run!.startsWith("npm") ? "npm" : "bun"}'`));
    for (const step of deep.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});

test("CodeQL skips prose but includes executable tracker changes", () => {
  const codeql = workflow(".github/workflows/codeql.yml");
  for (const event of ["push", "pull_request"]) {
    const patterns = codeql.on[event].paths!;
    assert.ok(patterns);
    for (const [path, expected] of [["README.md", false], ["docs/example.json", false], [".agents/pm/tasks/example.toon", false],
      [".agents/pm/check.ts", true], [".agents/pm/nested/check.mjs", true], ["index.ts", true]] as const) {
      const selected = patterns.reduce((value, pattern) => matchesGlob(path, pattern.replace(/^!/, "")) ? !pattern.startsWith("!") : value, false);
      assert.equal(selected, expected, path);
    }
  }
});

test("all root and shipped workflow YAML parses strictly", () => {
  for (const directory of [".github/workflows/"]) {
    for (const name of readdirSync(new URL("../" + directory, import.meta.url))) {
      if (/\.ya?ml$/.test(name)) workflow(directory + name);
    }
  }
});

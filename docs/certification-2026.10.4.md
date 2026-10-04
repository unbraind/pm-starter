# PM CLI/SDK 2026.10.4 certification

Item: [pm-starter-cz6b](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-cz6b.toon).

Consolidates Dependabot #117, #120 and #121 including the exact CodeQL SHA, pins published PM CLI/SDK, pm-ops and pm-changelog 2026.10.4 plus exact current devDependencies, refreshes npm and adds a Bun lock, and copies the published canonical merge-driver launcher unchanged. Three regressions cover broken directories, dangling links and inconclusive lookup.

```json
{
  "@types/node": "26.6.4",
  "@unbrained/pm-cli": "2026.10.4",
  "pm-changelog": "2026.10.4",
  "pm-ops": "2026.10.4",
  "typescript": "7.0.2"
}
```

## Real-data compatibility fix

Initial packed `npx -y @unbrained/pm-cli@2026.10.4 starter demo --json` correctly refused a default-budget partial tracker read: `the row list was truncated (4 of 71 item(s) returned)`. A test-first six-large-body regression also reproduced default field compaction. The shared reader now uses `pm list --status all --full --include-body --no-truncate --strict-read --json`, preserving its fail-closed receipt checks and buffer bound.

`node --test --test-name-pattern='complete large tracker' test/smoke.test.ts` failed before the reader fix and passes afterward, including all six complete bodies. All 107 command tests pass. CLI 2026.8.15's `list --help` confirms --status all, --full, --include-body, --no-truncate and --strict-read. Its help lacks --all, so the final reader uses --status all; peer/manifest floor remains 2026.8.15. The floor check establishes availability of these options, not whole-package runtime acceptance at that version.

## Validation

Every install, full gate, build/pack and packed acceptance command ran while holding `/tmp/claude-1000/heavy-gate.lock` (serialized scripts `gate-starter.sh` / `reverify-starter.sh`).

- `npm install` and `bun install`: pass; current npm and Bun resolutions agree on direct pins.
- `npm run release:check`: pass after the fix, 200/200 tests, zero skipped; 100% lines/branches/functions across the three enforced files (`index.ts`, `scripts/coverage-gate.ts`, `scripts/docstring-gate.ts`). Docstring gate covers six files/32 declarations; audit/pack/changelog/publish attestation pass.
- `npx pm test pm-starter-cz6b --run --only-last --progress`: linked snapshot complete-read regression passes; earlier linked launcher test passed 9/9.
- `npm audit --omit=dev` and `npm audit`: zero vulnerabilities. Open security alerts: none.
- `npx pm health --strict-exit --require-merge-drivers`: exit 0, ok true, with inherited advisory `stale_in_progress_items:1`.
- Rebuilt tracked `dist/` is committed with the source change for CI's clean-build drift check.

Independent statement coverage and all-executable source coverage remain unmeasured and tracked in [pm-starter-puy5](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/issues/pm-starter-puy5.toon). Passing the configured gate does not close that issue or establish 100/100/100/100 across the repository.

## Managed GitHub preview

`npx pm package install npm:pm-github@2026.10.4 --project` passed. Read-only `npx pm github sync --repo unbraind/pm-starter --dry-run` returned:

```text
No pm items linked to unbraind/pm-starter (no `gh:unbraind/pm-starter#N` provenance tags).
synced: 0
skipped: 0
planned: 0

```

No GitHub-linked items means this is zero-case evidence. No issues were written and no scheduled sync enabled. Only the managed manifest is committed; fresh clones install its generated extension files with the README command.

## Packed copied-real-tracker dogfood

Packed with `npm pack --silent --pack-destination /tmp/claude-1000`, copied this repository's complete `.agents/pm` to `/tmp/claude-1000/cert-wt/pm-starter-dogfood/.agents/pm`, installed the tarball plus CLI 2026.10.4 with `npm install --save-exact /tmp/claude-1000/pm-starter-2026.10.3.tgz @unbrained/pm-cli@2026.10.4`, and activated it with `npx -y @unbrained/pm-cli@2026.10.4 package install /tmp/claude-1000/pm-starter-2026.10.3.tgz --project`.

Both `npx -y @unbrained/pm-cli@2026.10.4` and `bunx --bun -y @unbrained/pm-cli@2026.10.4` passed:

```sh
starter greet --name Certifier --json
starter summary --json
starter demo --json
starter context --json
starter search certification --json
starter setup --name cert-extension --capability commands,search --json
starter-demo export --json
```

Summary, demo and exporter each account for all 71 real tracker items. Search returns the coverage issue `pm-starter-puy5` in both runtimes; setup returns its scaffold plan. The scratch tracker was deleted by the exit trap. [Exact commands and complete outputs](evidence/pm-starter-2026.10.4-dogfood.log).

CI and substantive reviewer receipts are assessed separately on the final PR head. Items remain open for orchestrator verification.

Review follow-up: the dangling-link fixture uses a Windows junction and a POSIX directory link, following [Node filesystem APIs](https://nodejs.org/api/fs.html#fssymlinksynctarget-path-type). Scoped launcher tests pass 9/9 on Linux. Native Windows execution has not been verified. No skip guards were added; the canonical launcher is unchanged.

CI follow-up: the captured global extension path is represented as `$HOME/.pm-cli/extensions` in the public receipt. The original absolute path was removed from this PR branch history; the unchanged identity/privacy audit is rerun after commit. CodeRabbit identified stale certification acceptance criteria; only their version target was advanced to 2026.10.4, keeping all other completion checks. GitHub retains old commit objects independently; this change does not resolve older repository-wide public-history privacy debt.

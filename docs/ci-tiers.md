# Fleet CI v2

Required checks remain `test (22)` and `test (26)`. PRs and dispatch run on
hosted Ubuntu at quick depth, with superseded PR cancellation and ten-minute
job ceilings. CodeQL is optional and runs separately. Docs/tracker-only PRs
retain strict health, changelog and identity/absolute-home-path history audits;
executable tracker JavaScript/TypeScript selects the code tier.

| Check | Code PR Node 22 | Code PR Node 26 | Docs/tracker PR, both | Deep Node 22 + 26 |
| --- | --- | --- | --- | --- |
| npm ci and merge-driver preparation | yes | yes | yes | yes |
| Pinned project pm-github extension | yes | yes | yes | yes |
| Strict tracker health / merge drivers | — | yes | yes | yes |
| Build and committed dist consistency | yes | yes | — | yes |
| Typecheck and docstrings | build checks types | yes | — | npm + Bun |
| Test compilation and behavioral/CLI acceptance tests | quick | quick via coverage | — | full, npm + Bun |
| Coverage, unchanged 100% lines/branches/functions | — | yes | — | npm + Bun |
| Identity and absolute-home-path history audits | via tests | via tests | yes | npm + Bun |
| Production audit and pack dry-run | — | yes | — | npm + Bun |
| Changelog consistency | — | yes | yes | npm + Bun |
| Publish attestation verifier | — | yes | — | npm + Bun |
| Bun graph install and bunx local compiler smoke | — | yes | — | fresh Bun graph; bunx in PR |
| CodeQL | matching paths | matching paths | filtered | main matching paths; weekly |

All old gate contracts remain. Provision the already-declared pm-github 2026.10.4
project extension before health and restore its managed registry after setup;
this avoids an ambient CLI/extension host version mismatch. This repository has no lint script or duplicate
gate, and this change does not invent either as a CI requirement. Local changed
TypeScript is also checked with the canonical pm-ops ESLint policy using an
available external tool installation, because this package does not install its
optional parser peers.

Deep runs on main pushes, dispatch and daily at 02:29 UTC, separate from release
at 03:23 UTC and its hourly minute-41 recovery, and weekly CodeQL on Monday at
05:53 UTC. The checks are `deep (22)` and `deep (26)`; both run full npm and Bun
release gates with a 120-minute job ceiling, `PM_TEST_DEPTH=full` and
`PM_TEST_TIME_SCALE=3`. The Bun gate follows a fresh Bun graph installation.
Per-ref concurrency cancels superseded deep runs. Jobs use the `pm-local` pool
unless `PM_LOCAL_DEEP=off` selects hosted fallback. Only the fleet controller
changes that variable. Local setup-node skips remote npm cache restoration;
setup-bun runs only on hosted fallback and all deep jobs log `bun --version`.

Unset depth means full. Quick uses the first 50 of each 500-case arithmetic or
seeded sequence. Seed initialization, generation and per-case assertions are
unchanged. Fixed native-pagination boundaries (51 and 401 items), fault/crash
matrices and all explicit regression cases remain complete. Coverage thresholds
and source scope are unchanged. The configured reporter measures lines,
branches and functions; independent statement coverage remains outside this
claim and tracked separately by `pm-starter-puy5`.

There are no elapsed-time product contracts or fixed test deadlines in the
regular suite. The standalone packed-consumer harness scales only its external
command watchdog with `PM_TEST_TIME_SCALE`, rounds upward to integer milliseconds
and rejects nonpositive, nonfinite or overflowing budgets. Product limits and
assertions are unchanged.

`validate-consumer-pack.ts` independently proves npm/Bun global hosts, npx/bunx
and a project-local host against one captured tarball. It is not called by
`release:check`, so it is not claimed as PR evidence. The PR adds explicit
`bunx --no-install tsc --version` and `bun install --no-save` smoke checks; these
prove local bin resolution and graph installation, not every ephemeral/global
registry route. Existing CLI installation and read-only receipt tests stay in
both test depths.

## Starter inheritance

The supported scaffold path is cloning this repository, as documented in README.
`starter setup` prints a plan and returns `scaffolded:false`; it does not generate
another package. Clones inherit `.github/workflows/ci.yml`, `ci-deep.yml`,
`codeql.yml` and `test/support/depth.ts` directly. Keep those paths when trimming
capabilities, and adapt package metadata, tests and tracker ownership together.
No existing template-instantiation test was removed or skipped. No new generator
or recursive test-of-the-entire-gate is introduced.

## Measurements

Owner fleet measurement: 39,929 runner-minutes in 24 hours, median PR latency
45–90 minutes, approximately 28 minutes queueing. These are fleet observations.

Latest successful main [run 43681245615](https://github.com/unbraind/pm-starter/actions/runs/43681245615):
Node 22 npm/Bun gates 64s/61s; Node 26 56s/55s. Overall run wall time was 12m48s,
including queueing. Individual job logs supplied timings because
`gh run view --log` returned no content. Slowest tests: recipes property 16.10s,
CLI pagination acceptance 11.76s, pagination property 5.30s. Quick local results
and exact-head PR status are recorded in the package Task and PR body. Full
depth is not run locally; deep certification remains pending after merge.

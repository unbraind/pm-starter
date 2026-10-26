# pm-starter

The CANONICAL scaffold for [pm-cli](https://github.com/unbraind/pm-cli) extensions. A single, heavily-commented `index.ts` demonstrates **all 9 SDK capability types** with small, SAFE, inert examples.

Use this as a starting template for building your own extensions: copy the capability you need and delete the rest.

---

## Installation

```bash
pm install github.com/unbraind/pm-starter --project
```

## Capabilities

Every capability declared in `manifest.json` is demonstrated in `index.ts`. Each
maps to one or more `register*`/`hooks.*` calls on the `ExtensionApi`.

| # | Capability | `ExtensionApi` call(s) | What the demo registers |
|---|---|---|---|
| 1 | **commands** | `registerCommand` | `pm starter greet`, `pm starter summary`, `pm starter demo`, `pm starter plan`, `pm starter context`, `pm starter search`, `pm starter setup` |
| 2 | **renderers** | `registerRenderer` | `json` + `toon` renderer overrides (reshape only the `starter demo` payload, pass through everything else) |
| 3 | **hooks** | `hooks.beforeCommand`, `hooks.afterCommand`, `hooks.onWrite`, `hooks.onRead`, `hooks.onIndex` | All five lifecycle hooks (observe-only; opt-in logging via `PM_STARTER_HOOKS`) |
| 4 | **schema** | `registerItemFields`, `registerItemTypes`, `registerMigration` | Optional fields `starter_origin`/`starter_score`, a `StarterNote` item type, and a no-op migration `pm-starter-0001-noop` |
| 5 | **importers** | `registerImporter`, `registerExporter` | `pm starter-demo import` (inert dry-run) and `pm starter-demo export` (read-only JSON dump) |
| 6 | **search** | `registerSearchProvider`, `registerVectorStoreAdapter` | Search provider `starter-substring` and in-memory vector store adapter `starter-memory` |
| 7 | **parser** | `registerParser` | Identity pass-through parser override for the native `list` command |
| 8 | **preflight** | `registerPreflight` | Pass-through preflight decision override (no behavior change) |
| 9 | **services** | `registerService` | Pass-through override of the `output_format` core service |

> **Flags:** the demo commands declare typed `flags`, and `registerFlags("list", …)`
> adds an inert `--starter-tag` flag to the native `list` command. Flag registration
> is part of the **commands** capability — it does not need its own manifest entry.

## Commands

### `pm starter greet`
```bash
pm starter greet
pm starter greet --name Developer --emoji 🚀 --uppercase
```

### `pm starter summary`
```bash
pm starter summary
pm starter summary --verbose
```

### `pm starter demo`
```bash
pm starter demo            # structured payload reshaped by the starter renderer
pm starter demo --json
```

### `pm starter plan`
Integrates with pm's agent-optimized plan workflow (`pm plan show`).
```bash
pm starter plan pm-cli-website-6t9b          # show a plan summary
pm starter plan pm-cli-website-6t9b --steps   # include per-step breakdown
```

### `pm starter context`
Integrates with pm's token-efficient project context snapshot (`pm context`).
```bash
pm starter context                # compact context snapshot
pm starter context --depth deep   # deeper context
```

### `pm starter search`
Integrates with pm's keyword/semantic/hybrid search (`pm search`).
```bash
pm starter search authentication             # keyword search (default)
pm starter search "bug fix" --mode hybrid   # hybrid search
pm starter search deployment --mode semantic # semantic search
```

### `pm starter setup`
Guided setup helper for scaffolding a new extension.
```bash
pm starter setup --interactive                        # interactive wizard
pm starter setup --name my-ext --capability commands # scaffold plan
pm starter setup --name my-ext --capability commands,search,hooks
```

### Importer / exporter command paths

`registerImporter("starter-demo")` and `registerExporter("starter-demo")` auto-create:

```bash
pm starter-demo import     # inert dry-run preview
pm starter-demo export     # read-only JSON dump of items
```

> Human-facing commands are namespaced under `pm starter …` while the
> importer/exporter live under `pm starter-demo …` so the two command paths never
> collide. `pm extension doctor` reports 0 collisions as a result.

## Backend-neutral capability laboratories

Run a single capability against directory and synthetic remote adapters with identical,
compact typed receipts and an unsupported-mutation probe before either source read:

```sh
pm starter lab --capability commands --json
pm starter lab --capability importers --json
pm starter-lab export --json
pm starter lab --operation mutate --json # typed refusal, exit 1
```

The command example counts statuses; the exporter returns deterministic byte/digest
proof. Both use the injected SDK's certified complete read. The SDK exports
`runCapabilityLaboratory`, `executeCapabilityLaboratory`, both adapter factories,
and command/exporter handlers. See [the executable examples and contract](docs/capability-laboratories.md).
The synthetic transport uses structured cloning of certified values; hosted-provider
acceptance is a separate concern. A changing source fails parity explicitly.

## Without git

All starter commands, the read-only exporters, both laboratories and the failure-first
recovery recipes work in a plain initialized tracker with no Git executable. Creating or running a laboratory needs
no repository. Cloning the starter and repository release/changelog automation need
Git. Laboratory commands require a host that injects the SDK (tested with 2026.10.20)
and return an actionable refusal when it is absent.

## Architecture

Each capability lives in its own `setup*` function for clarity. Delete the ones
you don't need and prune `manifest.json` to match:

- `setupCommands(api)` — `registerCommand` (with typed flags, `failure_hints`, `arguments`, and `--interactive` guided setup)
- `setupRenderers(api)` — `registerRenderer` for `json` / `toon`
- `setupHooks(api)` — `hooks.beforeCommand/afterCommand/onWrite/onRead/onIndex`
- `setupSchema(api)` — `registerItemFields` / `registerItemTypes` / `registerMigration`
- `setupImportExport(api)` — `registerImporter` / `registerExporter`
- `setupSearch(api)` — `registerSearchProvider` / `registerVectorStoreAdapter`
- `setupParser(api)` — `registerParser`
- `setupPreflight(api)` — `registerPreflight`
- `setupServices(api)` — `registerService`
- `setupFlags(api)` — `registerFlags`

## The zero-runtime-coupling pattern

Standalone-installed extensions load only their own `dist/` at runtime, so
`@unbrained/pm-cli` is **not** resolvable as a runtime value. `index.ts` therefore
imports `defineExtension` as a **type only** and provides a trivial identity
implementation; the real CLI supplies the live `api` object at activation time.
For the same reason the `EXIT_CODE` / `CommandError` error contract is
re-implemented locally rather than imported from the SDK.

## Complete SDK reads

`starter demo` and `starter-demo export` use `ctx.sdk.client.listAllComplete`
with full bodies, including closed and canceled items. The SDK calls
`certifyCompleteListResult` itself: there is no external JSON envelope parser
or local completeness policy left in this package. Both commands then call the
SDK history action with `verify: true` for each item. That action reads fresh
history and uses `verifyHistoryEntries`, including comparison with the current
item, before returning a verification receipt. A cached event index is never
accepted as integrity evidence. These reads work without `pm` or `git` on PATH.

Install and activation require pm-cli >=2026.8.18, the first published stable
release with `PmClient.listAllComplete`. The development SDK remains pinned to
2026.10.20. See the [published API inventory](docs/sdk-floor.md) for every used
capability and its first-release artifact evidence. Hosts without SDK injection
receive an explicit failed-read outcome. Failed or incomplete reads
continue to fail with exit code 1, including exports; they never become an empty
workspace. SDK certification is intentionally stricter about counts, unique IDs,
full projections, unbounded delivery and omission receipts. Invalid history now
fails explicitly, even if a previous cached read succeeded. `PM_JSON_MAX_BUFFER`
continues to apply to the other subprocess examples; SDK reads do not use it.
The exported `readPmItems` helper now accepts the host SDK context and returns a
Promise. The former `describeListAllIncompleteness` helper was removed with its
local policy. SDK rows can retain optional properties with value `undefined`
that CLI JSON omitted; their serialized values are identical. Renderer ownership and callback guards retain their existing scope.

## SDK 2026.7.6 patterns

The starter demonstrates several patterns introduced or stabilized in the
2026.7.6 SDK:

- **`failure_hints`**: command definitions can include a `failure_hints` string
  array that surfaces actionable guidance when a command exits non-zero. Used on
  `starter summary`, `starter plan`, `starter context`, `starter search`, and
  `starter setup`.
- **`arguments`**: command definitions can declare typed positional arguments
  (`name`, `required`, `variadic`, `description`) surfaced in help. Used on
  `starter plan` (required `id`) and `starter search` (variadic `keywords`).
- **`--interactive` flag pattern**: `starter setup --interactive` walks through a
  guided setup wizard, demonstrating the pattern for agent- or human-driven
  interactive configuration.
- **Better error messages**: all commands that shell out to `pm` include the
  first line of stderr in their `CommandError` message and suggest a concrete fix
  (e.g. `pm init`, `pm get <id>`, `pm plan create`).

## Creating a New Extension

```bash
# 1. Clone this repo
git clone https://github.com/unbraind/pm-starter.git my-extension
cd my-extension

# 2. Edit files
#    - manifest.json: update name, description, capabilities
#    - index.ts: keep only the capabilities you need, implement your logic
#    - package.json: update name

# 3. Build and test
npm install
npm run build

# 4. Install locally
pm install ./my-extension --project
```

## License

MIT

## Release Automation

This package is release-ready for GitHub, npm, and Bun-compatible installs. CI runs type checking, build, production dependency audit, package packing, Bun install verification, and pm-changelog validation. The daily release workflow publishes only when commits exist after the latest release tag and uses pm-changelog to generate CHANGELOG.md and GitHub release notes.

## Multi-agent merge safety

This repo tracks its project management in `.agents/pm/` and ships a committed `.gitattributes`
that maps those tracker artifacts to pm-cli's field-aware Git merge drivers, so concurrent-branch
tracker edits merge cleanly instead of hard-conflicting. The driver **definitions** live in
per-clone Git config; `npm install` / `npm ci` wires them automatically via the `prepare` script, `scripts/prepare-merge-driver.ts`: the launcher template pm-ops ships, copied unchanged, which a test compares byte for byte with the pinned template. It runs pm-ops's installer, which calls `pm merge install` when the `pm` CLI is on `PATH` and skips with a notice when it is not. A production install of a clone (`npm ci --omit=dev`) has no `pm-ops`, so the launcher skips with one notice, while a stale or broken `pm-ops` fails the install. Registry installs of this package never run `prepare`. Being Node-based, it behaves identically on POSIX shells and Windows `cmd.exe`. To (re)run manually: `npm run merge:install`.

After merging a branch that touched `.agents/pm/`, reconcile any residual history-hash drift with
**`pm merge reconcile`** (pm-cli ≥ 2026.7.22): preview with `pm merge reconcile --dry-run`, apply with
`pm merge reconcile --message "post-merge reconcile"`, then confirm with `pm validate`, which scans the
whole tracker and flags remaining history drift across **every** affected item (`pm merge reconcile`
itself lists each affected stream in its output; `pm history --verify <id>` spot-checks one item). The field-aware driver already unions every author's
content, so `reconcile` only re-greens the hash chain (no data loss) — see the authoritative
[pm-cli merge-safety guide](https://github.com/unbraind/pm-cli/blob/main/docs/MERGE_SAFETY.md). The
older blunt `pm history-repair --all` remains available as a lower-level primitive.


## Complete tracker reads and certification

The shared demo/export/search reader requests `pm list --status all --full --include-body --no-truncate --strict-read --json`. Full projection and no truncation preserve complete item bodies and rows beyond the CLI's default output budget; strict reads and completeness receipts keep malformed or partial trackers as failures.

Fresh clones install the managed GitHub extension before a read-only preview:

```sh
npx pm package install npm:pm-github@2026.10.4 --project
npx pm github sync --repo unbraind/pm-starter --dry-run
```

This does not enable scheduled sync. See `docs/certification-2026.10.4.md` for validation and copied-real-tracker evidence. Whole-executable and statement coverage remains tracked in `pm-starter-puy5`.

## Failure-first task recipes

`pm starter recover --json` deliberately encounters three native refusals and
finishes each read through a structured recovery contract. Use
`--recipe missing-item|unsupported-capability|insufficient-budget` for one loop,
or `--output-format toon` for compact TOON receipts. The typed
`runFailureFirstRecipes(ctx.sdk, { recipe: 'all' })` API uses the same code path.

The workflows discover a valid item ID, select an advertised graph read, and
recover an infeasible output budget using the SDK's certified complete-list
helper. They read existing trackers without Git and never execute suggested
shell text or write item data. Each receipt asserts its native discriminator,
remedy and successful retry; the missing-item SDK classifier is labeled
explicitly. See the [runnable CLI and SDK examples](docs/failure-first-recipes.md)
for contracts, refusal codes and concurrency limits.

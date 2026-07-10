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

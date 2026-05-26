# pm-starter

Complete scaffold for [pm-cli](https://github.com/unbraind/pm-cli) extensions. Demonstrates all 8 capability types in one file.

Use this as a starting template for building your own extensions.

---

## Installation

```bash
pm install github.com/unbraind/pm-starter --project
```

## Capabilities

| # | Capability | What it does |
|---|---|---|
| 1 | **Commands** | `pm starter greet` and `pm starter summary` |
| 2 | **Schema** | Title validation (required, ≤ 200 chars) |
| 3 | **Hooks** | afterCreate, afterClose, beforeUpdate |
| 4 | **Importers** | Demo `starter-demo` importer |
| 5 | **Renderers** | `compact` (TSV) and `markdown-table` renderers |
| 6 | **Search** | `starter-substring` case-insensitive search |
| 7 | **Preflight** | `starter-preflight` workspace health check |
| 8 | **Services** | `starter-health` health check service |

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
pm install ./my-extension
```

## Architecture

Each capability is in its own setup function for clarity:
- `setupCommands(api)` — Register CLI commands with flags
- `setupSchema(api)` — Register validation schemas
- `setupHooks(api)` — Register lifecycle hooks
- `setupImporters(api)` — Register data importers
- `setupRenderers(api)` — Register output renderers
- `setupSearch(api)` — Register search providers
- `setupPreflight(api)` — Register pre-flight checks
- `setupServices(api)` — Register background services

Delete the capabilities you don't need and update `manifest.json` accordingly.

## License

MIT

## Release Automation

This package is release-ready for GitHub, npm, and Bun-compatible installs. CI runs type checking, build, production dependency audit, package packing, Bun install verification, and pm-changelog validation. The daily release workflow publishes only when commits exist after the latest release tag and uses pm-changelog to generate CHANGELOG.md and GitHub release notes.

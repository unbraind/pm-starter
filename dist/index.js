// pm-starter — the CANONICAL reference extension for pm-cli.
//
// This file is a learning template: it demonstrates EVERY capability of the
// pm-cli ExtensionApi with a small, SAFE, heavily-commented example of each.
// Copy the pattern you need into your own extension and delete the rest.
//
// Each demonstration is labelled in comments as "DEMO: <capability>" and is
// deliberately INERT — no destructive behavior and no network access. The demos
// only read (via `pm ... --json`), print, or return data; they never delete or
// mutate your workspace on their own.
//
// ---------------------------------------------------------------------------
// CAPABILITY → setup function → manifest capability  (see README for the full
// copy-paste matrix):
//
//   registerCommand            setupCommands          "commands"
//   registerRenderer           setupRenderers         "renderers"
//   hooks.before/after/        setupHooks             "hooks"
//     onWrite/onRead/onIndex
//   registerItemFields         setupSchema            "schema"
//   registerItemTypes          setupSchema            "schema"
//   registerMigration          setupSchema            "schema"
//   registerImporter           setupImportExport      "importers"
//   registerExporter           setupImportExport      "importers"
//   registerSearchProvider     setupSearch            "search"
//   registerVectorStoreAdapter setupSearch            "search"
//   registerParser             setupParser            "parser"
//   registerPreflight          setupPreflight         "preflight"
//   registerService            setupServices          "services"
//   registerFlags              setupFlags             "commands"
//
// NOTE on naming / collisions: `registerImporter("starter-demo")` auto-creates
// the command path `pm starter-demo import`, and `registerExporter("starter-demo")`
// creates `pm starter-demo export`. We therefore namespace our human-facing
// commands under `pm starter ...` (greet/summary/demo) so they never collide
// with the importer/exporter command paths under `pm starter-demo ...`.
// `pm extension doctor` reports 0 collisions as a result.
//
// ---------------------------------------------------------------------------
import { spawnSync } from "node:child_process";
// Standalone-installed extensions load ONLY their own `dist/` at runtime, so
// `@unbrained/pm-cli` is not resolvable as a runtime value. We therefore use the
// zero-runtime-coupling pattern: import `defineExtension` as a TYPE only and
// provide a trivial identity implementation. The real CLI supplies the live
// `api` object at activation time.
const defineExtension = ((extension) => extension);
// ---------------------------------------------------------------------------
// Error contract (re-implemented locally — DO NOT import from the SDK)
//
// pm's extension command runtime only treats a thrown error as a cleanly
// handled non-zero exit when the error carries a numeric `exitCode` property
// (see @unbrained/pm-cli runCommandHandler). A plain `Error` makes the runtime
// fall through to its "unhandled" path, which RE-INVOKES the command handler a
// second time — doubling side effects and exiting with a generic code instead
// of a semantic one. We mirror the SDK's EXIT_CODE contract here rather than
// importing it, because standalone extensions cannot resolve the SDK at runtime.
// ---------------------------------------------------------------------------
export const EXIT_CODE = {
    GENERIC_FAILURE: 1,
    USAGE: 2,
    NOT_FOUND: 3,
};
export class CommandError extends Error {
    exitCode;
    constructor(message, exitCode = EXIT_CODE.GENERIC_FAILURE) {
        super(message);
        this.name = "CommandError";
        this.exitCode = exitCode;
    }
}
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/**
 * Read a boolean option honoring both the kebab-case long flag and the
 * camelCase key the runtime may normalize it to (e.g. `--dry-run` -> `dryRun`).
 * Without this, `ctx.options["dry-run"]` can silently be `undefined`.
 */
export function optionEnabled(options, ...keys) {
    return keys.some((k) => {
        const v = options[k];
        return v === true || v === "true" || v === "1";
    });
}
/** Read a string option, trying multiple key spellings; returns undefined if absent. */
export function optionString(options, ...keys) {
    for (const k of keys) {
        const v = options[k];
        if (typeof v === "string" && v.trim().length > 0)
            return v.trim();
    }
    return undefined;
}
/**
 * Safely read all items from the workspace by shelling out to `pm`. Returns an
 * empty array on any failure so demos never throw at activation/read time.
 * This is the SAFE read pattern every demo reuses.
 */
export function readPmItems(pmRoot) {
    const result = spawnSync("pm", ["--path", pmRoot, "list-all", "--json", "--include-body"], { encoding: "utf-8" });
    if (result.status !== 0)
        return [];
    try {
        const parsed = JSON.parse(result.stdout);
        if (Array.isArray(parsed))
            return parsed;
        return parsed.items ?? parsed.results ?? [];
    }
    catch {
        return [];
    }
}
// ---------------------------------------------------------------------------
// DEMO: commands (registerCommand)
//
// Three commands, all under the `pm starter ...` namespace so they never
// collide with the importer/exporter command paths (`pm starter-demo ...`).
// `greet` and `summary` are kept for backward compatibility.
// ---------------------------------------------------------------------------
function setupCommands(api) {
    // DEMO: registerCommand — a self-contained command with typed flags.
    // Because this command declares a `flags` array, the manifest MUST also list
    // the "schema" capability (the flag schema), in addition to "commands".
    api.registerCommand({
        name: "starter greet",
        description: "A demo greeting command from the starter extension.",
        intent: "demonstrate command registration with flags",
        examples: [
            "pm starter greet",
            "pm starter greet --name Developer",
            "pm starter greet --name Dev --uppercase",
        ],
        flags: [
            { long: "--name", value_name: "name", description: "Name to greet (default: World)", type: "string" },
            { long: "--emoji", value_name: "emoji", description: "Emoji to include (default: wave)", type: "string" },
            { long: "--uppercase", description: "Uppercase the output", type: "boolean" },
        ],
        async run(ctx) {
            const name = optionString(ctx.options, "name") || "World";
            const emoji = optionString(ctx.options, "emoji") || "👋";
            const upper = optionEnabled(ctx.options, "uppercase");
            let message = `${emoji} Hello, ${name}!`;
            if (upper)
                message = message.toUpperCase();
            // Print human output to stderr; return structured data for --json hosts.
            console.error(message);
            return { message };
        },
    });
    // DEMO: registerCommand — a command that calls back into `pm` (read-only).
    api.registerCommand({
        name: "starter summary",
        description: "Show a quick workspace summary using `pm stats`.",
        intent: "demonstrate calling pm from an extension",
        examples: ["pm starter summary", "pm starter summary --verbose"],
        flags: [
            { long: "--verbose", description: "Include a per-type breakdown", type: "boolean" },
        ],
        async run(ctx) {
            const result = spawnSync("pm", ["--path", ctx.pm_root, "stats", "--json"], {
                encoding: "utf-8",
            });
            if (result.status !== 0) {
                // Throw a CommandError (carrying an exitCode) so the CLI exits non-zero
                // exactly ONCE rather than re-invoking this handler.
                throw new CommandError("`pm stats` failed", EXIT_CODE.GENERIC_FAILURE);
            }
            let stats;
            try {
                stats = JSON.parse(result.stdout);
            }
            catch {
                throw new CommandError("Could not parse `pm stats --json` output.");
            }
            const total = stats.totals?.items ?? 0;
            const byStatus = stats.by_status ?? {};
            console.error(`\n  Workspace Summary\n  =================`);
            console.error(`  Total items: ${total}`);
            for (const [status, count] of Object.entries(byStatus)) {
                if (count > 0)
                    console.error(`  ${status}: ${count}`);
            }
            if (optionEnabled(ctx.options, "verbose") && stats.by_type) {
                console.error(`\n  By type:`);
                for (const [type, count] of Object.entries(stats.by_type)) {
                    if (count > 0)
                        console.error(`    ${type}: ${count}`);
                }
            }
            return stats;
        },
    });
    // DEMO: registerCommand — a command whose RESULT is reshaped by our renderer
    // override (see setupRenderers). Run `pm starter demo --json` /
    // `pm --toon starter demo` to see the custom rendering kick in.
    api.registerCommand({
        name: "starter demo",
        description: "Emit a small structured result that the starter renderer reshapes.",
        intent: "demonstrate a command result flowing through a custom renderer",
        examples: ["pm starter demo", "pm starter demo --json"],
        async run(ctx) {
            const items = readPmItems(ctx.pm_root);
            // Return a small, predictable shape the renderer override can recognize.
            return {
                starter_demo: true,
                item_count: items.length,
                sample: items.slice(0, 3).map((i) => ({ id: i.id, title: i.title, status: i.status })),
            };
        },
    });
}
// ---------------------------------------------------------------------------
// DEMO: renderers (registerRenderer)
//
// A renderer override receives the command RESULT and returns the final string
// the CLI prints. Valid formats are ONLY "toon" and "json". We make both
// pass-through-safe: if we don't recognize the payload, we fall back to the
// default serialization so we never break unrelated commands.
// ---------------------------------------------------------------------------
function setupRenderers(api) {
    // DEMO: registerRenderer("json") — reshape ONLY our own `starter demo`
    // payload. A renderer override is registered per-format and is invoked for
    // EVERY command using that format, so for anything that isn't our payload we
    // return a non-string (null): pm then falls through to its native renderer
    // and no other command's output is altered. This is the safe pattern — never
    // globally hijack toon/json output from a shared extension.
    api.registerRenderer("json", (ctx) => {
        const result = ctx.result;
        if (result && typeof result === "object" && result.starter_demo) {
            return JSON.stringify({ rendered_by: "pm-starter", ...result }, null, 2);
        }
        return null; // not ours → native rendering
    });
    // DEMO: registerRenderer("toon") — a compact line view for OUR payload only;
    // null for everything else so native TOON rendering is preserved.
    api.registerRenderer("toon", (ctx) => {
        const result = ctx.result;
        if (result && typeof result === "object" && result.starter_demo) {
            const r = result;
            const lines = [`pm-starter demo — ${r.item_count} item(s)`];
            for (const s of r.sample ?? [])
                lines.push(`  ${s.id}\t${s.status}\t${s.title}`);
            return lines.join("\n");
        }
        return null; // not ours → native rendering
    });
}
// ---------------------------------------------------------------------------
// DEMO: hooks (all five)
//
// Hooks are observe-only here. They print to stderr only when the opt-in
// env var PM_STARTER_HOOKS is set, so installing the reference extension never
// adds noise to an unrelated workspace.
// ---------------------------------------------------------------------------
function setupHooks(api) {
    const enabled = () => Boolean(process.env.PM_STARTER_HOOKS);
    const log = (msg) => { if (enabled())
        console.error(`[pm-starter] ${msg}`); };
    // DEMO: hooks.beforeCommand — runs before any command handler.
    api.hooks.beforeCommand((ctx) => {
        log(`beforeCommand: ${ctx.command} ${(ctx.args ?? []).join(" ")}`.trimEnd());
    });
    // DEMO: hooks.afterCommand — runs after a command, with ok/error/result.
    api.hooks.afterCommand((ctx) => {
        log(`afterCommand: ${ctx.command} -> ${ctx.ok ? "ok" : `error: ${ctx.error ?? "?"}`}`);
    });
    // DEMO: hooks.onWrite — fires when pm writes an item file to disk.
    api.hooks.onWrite((ctx) => {
        log(`onWrite: ${ctx.op} ${ctx.scope} ${ctx.path}`);
    });
    // DEMO: hooks.onRead — fires when pm reads an item file.
    api.hooks.onRead((ctx) => {
        log(`onRead: ${ctx?.path ?? "(item)"}`);
    });
    // DEMO: hooks.onIndex — fires when pm (re)indexes items for search.
    api.hooks.onIndex((ctx) => {
        log(`onIndex: ${(ctx && (ctx.count ?? ctx.path)) ?? "(index event)"}`);
    });
}
// ---------------------------------------------------------------------------
// DEMO: schema (registerItemFields + registerItemTypes + registerMigration)
//
// All three are declarative and additive. They teach the workspace about new
// fields/types and a no-op migration; nothing is mutated until a user opts in
// by creating items of the new type.
// ---------------------------------------------------------------------------
function setupSchema(api) {
    // DEMO: registerItemFields — declare optional custom fields so the workspace
    // knows about them (and tooling/validation can surface them).
    api.registerItemFields([
        { name: "starter_origin", type: "string", optional: true },
        { name: "starter_score", type: "number", optional: true },
    ]);
    // DEMO: registerItemTypes — declare a custom item type. `folder` keeps its
    // markdown under a dedicated directory; `aliases` give short CLI handles.
    api.registerItemTypes([
        {
            name: "StarterNote",
            folder: "starter-notes",
            aliases: ["snote"],
            required_create_fields: ["title"],
        },
    ]);
    // DEMO: registerMigration — a safe, idempotent, no-op migration. A real
    // migration would transform existing items; this one only records that it
    // ran so authors can see the migration plumbing without risking data.
    api.registerMigration({
        id: "pm-starter-0001-noop",
        description: "DEMO: inert starter migration (no-op; records that it ran).",
        // The runtime calls up() during migration runs. We do nothing destructive.
        up(_ctx) {
            // Intentionally a no-op. Return a benign summary.
            return { migrated: 0, note: "pm-starter demo migration is a no-op" };
        },
    });
}
// ---------------------------------------------------------------------------
// DEMO: importers + exporters (registerImporter / registerExporter)
//
// registerImporter("starter-demo") creates `pm starter-demo import`.
// registerExporter("starter-demo") creates `pm starter-demo export`.
// Both are safe: the importer only previews (never writes unless explicitly
// told to with --commit, which we deliberately do NOT implement here to keep
// the reference inert); the exporter only reads and prints.
// ---------------------------------------------------------------------------
function setupImportExport(api) {
    // DEMO: registerImporter — `pm starter-demo import`.
    // Inert by design: it describes what a real importer WOULD do and returns a
    // dry-run-style summary. Swap the body for real parse + `pm create` calls.
    api.registerImporter("starter-demo", async (ctx) => {
        const source = optionString(ctx.options || {}, "file", "url") || "(no source given)";
        console.error(`[pm-starter] DEMO importer: would import from ${source}. ` +
            "This reference importer is inert — implement parse + `pm create` here.");
        return { imported: 0, dryRun: true, source };
    });
    // DEMO: registerExporter — `pm starter-demo export`.
    // Read-only: serializes the current items to a compact JSON payload and
    // prints it (or returns it for --json hosts). Never writes to disk.
    api.registerExporter("starter-demo", async (ctx) => {
        const items = readPmItems(ctx.pm_root);
        const payload = items.map((i) => ({
            id: i.id,
            title: i.title,
            type: i.type,
            status: i.status,
        }));
        console.log(JSON.stringify(payload, null, 2));
        return { exported: payload.length, format: "json" };
    });
}
// ---------------------------------------------------------------------------
// DEMO: search (registerSearchProvider + registerVectorStoreAdapter)
// ---------------------------------------------------------------------------
function setupSearch(api) {
    // DEMO: registerSearchProvider — a simple, dependency-free substring matcher
    // over title + body. Reads items via `pm` and filters in-process.
    api.registerSearchProvider({
        name: "starter-substring",
        async query(ctx) {
            const q = String(ctx?.query ?? "").toLowerCase();
            const items = readPmItems(ctx?.pm_root ?? ".");
            const results = !q
                ? []
                : items.filter((i) => {
                    const hay = `${i.title ?? ""} ${i.body ?? ""} ${i.description ?? ""}`.toLowerCase();
                    return hay.includes(q);
                });
            return { results, query: q };
        },
    });
    // DEMO: registerVectorStoreAdapter — an in-memory, deterministic adapter so
    // authors can see the vector-store contract without an external service.
    // It produces a tiny hashed pseudo-embedding (NOT a real model) and keeps
    // vectors in a Map for the lifetime of the process.
    const store = new Map();
    const pseudoEmbed = (text, dims = 8) => {
        const vec = new Array(dims).fill(0);
        for (let i = 0; i < text.length; i++)
            vec[i % dims] += text.charCodeAt(i) % 17;
        return vec;
    };
    api.registerVectorStoreAdapter({
        name: "starter-memory",
        async upsert(ctx) {
            const id = String(ctx?.id ?? "");
            const text = String(ctx?.text ?? ctx?.title ?? "");
            if (id)
                store.set(id, pseudoEmbed(text));
            return { upserted: id ? 1 : 0 };
        },
        async query(ctx) {
            // Return nearest by simple dot-product over the in-memory vectors.
            const qVec = pseudoEmbed(String(ctx?.query ?? ""));
            const scored = [...store.entries()].map(([id, v]) => ({
                id,
                score: v.reduce((s, x, i) => s + x * (qVec[i] ?? 0), 0),
            }));
            scored.sort((a, b) => b.score - a.score);
            return { results: scored.slice(0, ctx?.limit ?? 5) };
        },
    });
}
// ---------------------------------------------------------------------------
// DEMO: parser (registerParser)
//
// A parser override can pre-normalize args/options for a NATIVE command before
// its handler runs. We attach to `list` and pass everything through unchanged
// (a safe identity transform) so the reference never alters real behavior.
// ---------------------------------------------------------------------------
function setupParser(api) {
    // DEMO: registerParser — identity pass-through for the native `list` command.
    api.registerParser("list", (ctx) => {
        // A real override might inject a default flag, e.g. force --json. Here we
        // simply return args/options unchanged so behavior is identical.
        return { args: ctx?.args ?? [], options: ctx?.options ?? {} };
    });
}
// ---------------------------------------------------------------------------
// DEMO: preflight (registerPreflight)
//
// A preflight override can adjust the gate decisions the CLI makes before a
// command runs. We return a conservative pass-through that preserves the
// runtime's existing decision (or sane defaults), changing nothing.
// ---------------------------------------------------------------------------
function setupPreflight(api) {
    // DEMO: registerPreflight — pass-through decision (no behavior change).
    api.registerPreflight((ctx) => {
        const d = ctx?.decision ?? {};
        return {
            enforce_item_format_gate: d.enforce_item_format_gate ?? true,
            run_preflight_item_format_sync: d.run_preflight_item_format_sync ?? false,
            run_extension_migrations: d.run_extension_migrations ?? true,
            enforce_mandatory_migration_gate: d.enforce_mandatory_migration_gate ?? false,
        };
    });
}
// ---------------------------------------------------------------------------
// DEMO: services (registerService)
//
// A service override lets an extension supply/augment a named internal service.
// We override "output_format" with an inert pass-through that returns the
// existing/default format, demonstrating the hook point without changing output.
// ---------------------------------------------------------------------------
function setupServices(api) {
    // DEMO: registerService — a TRUE pass-through for the "output_format"
    // service. A service override replaces a core service for the whole CLI, so
    // the only safe demonstration is to return the incoming payload UNCHANGED
    // (returning a fabricated value here would corrupt every command's output).
    api.registerService("output_format", (ctx) => {
        return ctx?.payload;
    });
}
// ---------------------------------------------------------------------------
// DEMO: flags (registerFlags)
//
// registerFlags adds extra flags to an EXISTING native command (here, `list`).
// The flag is observe-only: native `list` ignores unknown options, and our
// parser/hook demos don't act on it — it exists purely to show the wiring.
// ---------------------------------------------------------------------------
function setupFlags(api) {
    // DEMO: registerFlags — augment the native `list` command with a demo flag.
    api.registerFlags("list", [
        {
            long: "--starter-tag",
            value_name: "tag",
            description: "DEMO flag added by pm-starter (inert; illustrates registerFlags).",
            type: "string",
        },
    ]);
}
// ---------------------------------------------------------------------------
// EXTENSION ENTRY POINT
// ---------------------------------------------------------------------------
export default defineExtension({
    name: "pm-starter",
    version: "2026.6.4",
    activate(api) {
        // Register every capability group. Each helper is defensive enough to be
        // safely deleted when you fork this scaffold for a real extension.
        setupCommands(api); // registerCommand
        setupRenderers(api); // registerRenderer (toon|json)
        setupHooks(api); // hooks.before/after/onWrite/onRead/onIndex
        setupSchema(api); // registerItemFields/registerItemTypes/registerMigration
        setupImportExport(api); // registerImporter/registerExporter
        setupSearch(api); // registerSearchProvider/registerVectorStoreAdapter
        setupParser(api); // registerParser
        setupPreflight(api); // registerPreflight
        setupServices(api); // registerService
        setupFlags(api); // registerFlags
    },
});
//# sourceMappingURL=index.js.map
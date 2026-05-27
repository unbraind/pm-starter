// pm-starter — Complete scaffold for pm-cli extensions
// Demonstrates all capability types. Copy this file to start a new extension.
//
// CAPABILITIES OVERVIEW:
//   1. commands   — Add custom CLI commands
//   2. schema     — Provide validation schemas
//   3. hooks      — React to lifecycle events (before/after create, update, close)
//   4. importers  — Programmatic data import
//   5. renderers  — Custom output formatting
//   6. search     — Custom search providers
//   7. preflight  — Pre-flight checks before commands run
//   8. services   — Background services and health checks
//
// To create a new extension from this scaffold:
//   1. Copy this directory
//   2. Update manifest.json name and capabilities
//   3. Delete capabilities you don't need
//   4. Implement your logic
//   5. npm install && npm run build
//   6. pm install ./your-extension
const defineExtension = ((extension) => extension);
// ---------------------------------------------------------------------------
// CAPABILITY 1: COMMANDS
// ---------------------------------------------------------------------------
function setupCommands(api) {
    // Example: a simple greeting command with flags
    api.registerCommand({
        name: "starter greet",
        description: "A demo greeting command from the starter extension.",
        intent: "demonstrate command registration",
        examples: [
            "pm starter greet",
            "pm starter greet --name Developer",
            "pm starter greet --name Dev --emoji 🚀",
        ],
        flags: [
            { long: "--name", value_name: "name", description: "Name to greet (default: World)" },
            { long: "--emoji", value_name: "emoji", description: "Emoji to include (default: 👋)" },
            { long: "--uppercase", description: "Uppercase the output" },
        ],
        async run(ctx) {
            const name = ctx.options["name"] || "World";
            const emoji = ctx.options["emoji"] || "👋";
            const upper = Boolean(ctx.options["uppercase"]);
            let msg = `${emoji} Hello, ${name}!`;
            if (upper)
                msg = msg.toUpperCase();
            console.error(msg);
            return { message: msg };
        },
    });
    // Example: a command that demonstrates pm interaction
    api.registerCommand({
        name: "starter summary",
        description: "Show a quick workspace summary using pm stats.",
        intent: "demonstrate calling pm from an extension",
        examples: ["pm starter summary"],
        flags: [
            { long: "--verbose", description: "Include detailed breakdown" },
        ],
        async run(ctx) {
            const { spawnSync } = await import("node:child_process");
            const result = spawnSync("pm", ["--path", ctx.pm_root, "stats", "--json"], {
                encoding: "utf-8",
            });
            if (result.status !== 0) {
                console.error("Failed to get stats");
                return { error: "pm stats failed" };
            }
            try {
                const stats = JSON.parse(result.stdout);
                const total = stats.totals?.items ?? 0;
                const byStatus = stats.by_status ?? {};
                console.error(`\n  Workspace Summary`);
                console.error(`  ================`);
                console.error(`  Total items: ${total}`);
                for (const [status, count] of Object.entries(byStatus)) {
                    if (count > 0) {
                        console.error(`  ${status}: ${count}`);
                    }
                }
                if (ctx.options["verbose"] && stats.by_type) {
                    console.error(`\n  By type:`);
                    for (const [type, count] of Object.entries(stats.by_type)) {
                        if (count > 0) {
                            console.error(`    ${type}: ${count}`);
                        }
                    }
                }
                return stats;
            }
            catch {
                console.error("Could not parse stats output");
                return { error: "parse failed" };
            }
        },
    });
}
// ---------------------------------------------------------------------------
// CAPABILITY 2: SCHEMA
// ---------------------------------------------------------------------------
function setupSchema(api) {
    if (typeof api.registerSchema !== "function")
        return;
    api.registerSchema({
        name: "starter-title-required",
        description: "Ensures items have a non-empty title",
        validate(item) {
            const errors = [];
            if (!item.title || item.title.trim().length === 0) {
                errors.push("Title is required");
            }
            if (item.title && item.title.length > 200) {
                errors.push("Title must be ≤ 200 characters");
            }
            return { valid: errors.length === 0, errors };
        },
    });
}
// ---------------------------------------------------------------------------
// CAPABILITY 3: HOOKS
// ---------------------------------------------------------------------------
function setupHooks(api) {
    if (typeof api.registerHook !== "function")
        return;
    // Hook: runs after any item is created
    api.registerHook("afterCreate", (ctx) => {
        const item = ctx.item;
        if (item) {
            console.error(`[starter] ✨ Item created: #${item.id} "${item.title}" (${item.type}/${item.status})`);
        }
    });
    // Hook: runs after any item is closed
    api.registerHook("afterClose", (ctx) => {
        const item = ctx.item;
        if (item) {
            console.error(`[starter] ✅ Item closed: #${item.id} "${item.title}"`);
        }
    });
    // Hook: runs before an item is updated
    api.registerHook("beforeUpdate", (ctx) => {
        // Could validate changes, log, or modify the update
        // Return false to prevent the update
    });
}
// ---------------------------------------------------------------------------
// CAPABILITY 4: IMPORTERS
// ---------------------------------------------------------------------------
function setupImporters(api) {
    if (typeof api.registerImporter !== "function")
        return;
    api.registerImporter("starter-demo", async (ctx) => {
        console.error("[starter] Demo importer running with config:", JSON.stringify(ctx.options));
        // Replace with real import logic:
        // 1. Read data from ctx.options.file or ctx.options.url
        // 2. Parse/transform
        // 3. Call pm create for each item
    });
}
// ---------------------------------------------------------------------------
// CAPABILITY 5: RENDERERS
// ---------------------------------------------------------------------------
function setupRenderers(api) {
    if (typeof api.registerRenderer !== "function")
        return;
    // Override the "json" format to add a compact table view
    api.registerRenderer("json", (items) => {
        return items
            .map((item) => `${item.id}\t${item.type?.padEnd(8)}\t${item.status?.padEnd(12)}\t${item.title}`)
            .join("\n");
    });
    // Override the "toon" format with a markdown table
    api.registerRenderer("toon", (items) => {
        const header = "| ID | Type | Status | Title |";
        const sep = "|---|---|---|---|";
        const rows = items.map((item) => `| ${item.id} | ${item.type || ""} | ${item.status || ""} | ${item.title} |`);
        return [header, sep, ...rows].join("\n");
    });
}
// ---------------------------------------------------------------------------
// CAPABILITY 6: SEARCH
// ---------------------------------------------------------------------------
function setupSearch(api) {
    if (typeof api.registerSearchProvider !== "function")
        return;
    // Simple substring search provider
    api.registerSearchProvider({
        name: "starter-substring",
        async query(ctx) {
            const query = ctx.query ?? "";
            const { spawnSync } = await import("node:child_process");
            const result = spawnSync("pm", ["--path", ctx.pm_root ?? ".", "list-all", "--json"], {
                encoding: "utf-8",
            });
            if (result.status !== 0)
                return { results: [] };
            const data = JSON.parse(result.stdout);
            const q = query.toLowerCase();
            const items = (data.items || []).filter((item) => {
                const title = (item.title || "").toLowerCase();
                const desc = (item.description || "").toLowerCase();
                return title.includes(q) || desc.includes(q);
            });
            return { results: items, query };
        },
    });
}
// ---------------------------------------------------------------------------
// CAPABILITY 7: PREFLIGHT
// ---------------------------------------------------------------------------
function setupPreflight(api) {
    if (typeof api.registerPreflight !== "function")
        return;
    // Preflight override — can modify preflight decisions before a command runs
    api.registerPreflight(async (ctx) => {
        console.error(`[starter] Preflight check for workspace: ${ctx.pm_root ?? "unknown"}`);
        // Return the current decision unchanged (pass-through)
        return {
            enforce_item_format_gate: ctx.decision?.enforce_item_format_gate ?? true,
            run_preflight_item_format_sync: ctx.decision?.run_preflight_item_format_sync ?? false,
            run_extension_migrations: ctx.decision?.run_extension_migrations ?? true,
            enforce_mandatory_migration_gate: ctx.decision?.enforce_mandatory_migration_gate ?? false,
        };
    });
}
// ---------------------------------------------------------------------------
// CAPABILITY 8: SERVICES
// ---------------------------------------------------------------------------
function setupServices(api) {
    if (typeof api.registerService !== "function")
        return;
    // Override the output_format service to add custom formatting
    api.registerService("output_format", async (ctx) => {
        console.error("[starter] output_format service override active");
        return { format: "toon" };
    });
}
// ---------------------------------------------------------------------------
// EXTENSION ENTRY POINT
// ---------------------------------------------------------------------------
export default defineExtension({
    name: "pm-starter",
    version: "2026.5.27",
    activate(api) {
        console.error("[pm-starter] Activating...");
        setupCommands(api);
        setupSchema(api);
        setupHooks(api);
        setupImporters(api);
        setupRenderers(api);
        setupSearch(api);
        setupPreflight(api);
        setupServices(api);
        console.error("[pm-starter] All 8 capabilities registered.");
        console.error("[pm-starter] Commands: pm starter greet, pm starter summary");
    },
});
//# sourceMappingURL=index.js.map
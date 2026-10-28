/** A diagnostic extension injecting transport faults after genuine SDK reads. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Write a test-only CLI bridge; the SDK always comes from the host context. */
export function writePaginationFaultExtension(directory: string, baselineModule: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "starter-page-fault", version: "1.0.0", type: "module" }));
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ name: "starter-page-fault", version: "1.0.0", entry: "./index.js", capabilities: ["commands", "preflight", "schema"] }));
  writeFileSync(join(directory, "index.js"), `
import { runTaskCostCommand } from ${JSON.stringify(pathToFileURL(baselineModule).href)};
export default {
  activate(api) {
    api.registerPreflight((ctx) => ({ ...ctx.decision, run_extension_migrations: false, run_preflight_item_format_sync: false }));
    api.registerCommand({
      name: "baseline adversary", description: "Inject a native pagination transport fault",
      flags: [
        { long: "--mode", type: "string", value_name: "mode", description: "declare, run or probe" },
        { long: "--fault", type: "string", value_name: "fault", description: "Contradictory, missing, duplicate or partial rows" }
      ],
      async run(ctx) {
        const sdk = ctx.sdk;
        const client = new Proxy(sdk.client, { get(target, property) {
          if (property === "list") return async (options) => {
            const page = await target.list(options);
            const fault = ctx.options.fault;
            if (fault === "partial") return { ...page, completeness: { status: "partial", unreadable_item_count: 1, unreadable_directory_count: 0 } };
            if (fault === "duplicate") return { ...page, items: [page.items[0], page.items[0]], count: 2, has_more: false, next_cursor: null };
            const bad = { ...page, items: page.items.slice(0, 1), count: 1, has_more: fault !== "short", next_cursor: null };
            if (fault === "compact-short") delete bad.has_more;
            return bad;
          };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        } });
        const injected = new Proxy(sdk, { get(target, property) { return property === "client" ? client : Reflect.get(target, property); } });
        const mode = ctx.options.mode || "declare";
        return runTaskCostCommand({ sdk: injected, options: {
          mode, scenario: "resume", corpusId: "pagination-cli", repeats: "1",
          ...(mode === "declare" ? {} : { corpusVersion: "v1", expectedAnswer: "resume:expected" })
        } });
      }
    });
  }
};
`);
}

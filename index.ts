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
// NEW in 2026.7.6 SDK: the `failure_hints` field on command definitions surfaces
// actionable hints when a command fails; the `--interactive` flag pattern shown
// below demonstrates guided setup; and the new `starter plan`, `starter
// context`, and `starter search` demo commands showcase pm's core plan
// workflow, context snapshot, and search capabilities respectively.
//
// NOTE on naming / collisions: `registerImporter("starter-demo")` auto-creates
// the command path `pm starter-demo import`, and `registerExporter("starter-demo")`
// creates `pm starter-demo export`. We therefore namespace our human-facing
// commands under `pm starter ...` (greet/summary/demo/plan/context/search)
// so they never collide with the importer/exporter command paths under
// `pm starter-demo ...`. `pm extension doctor` reports 0 collisions as a result.
//
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

import type { defineExtension as defineExtensionType } from "@unbrained/pm-cli/sdk";

// Standalone-installed extensions load ONLY their own `dist/` at runtime, so
// `@unbrained/pm-cli` is not resolvable as a runtime value. We therefore use the
// zero-runtime-coupling pattern: import `defineExtension` as a TYPE only and
// provide a trivial identity implementation. The real CLI supplies the live
// `api` object at activation time.
const defineExtension: typeof defineExtensionType = ((extension: any) => extension) as any;

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
} as const;
// NOTE: NOT_FOUND is used by `starter plan` when a plan ID does not exist,
// and USAGE is used by `starter plan`, `starter search`, and `starter setup`
// when required arguments are missing.

export class CommandError extends Error {
  exitCode: number;
  constructor(message: string, exitCode: number = EXIT_CODE.GENERIC_FAILURE) {
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
export function optionEnabled(options: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((k) => {
    const v = options[k];
    return v === true || v === "true" || v === "1";
  });
}

/** Read a string option, trying multiple key spellings; returns undefined if absent. */
export function optionString(options: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = options[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/** Read a positive integer option from either the SDK's numeric or string form. */
export function optionPositiveInteger(
  options: Record<string, unknown>,
  fallback: number,
  ...keys: string[]
): number {
  for (const k of keys) {
    const value = options[k];
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Safely read all items from the workspace by shelling out to `pm`. Returns an
 * empty array on any failure so demos never throw at activation/read time.
 * This is the SAFE read pattern every demo reuses.
 */
export function readPmItems(pmRoot: string): Array<Record<string, any>> {
  const result = spawnSync(
    "pm",
    ["--path", pmRoot, "list-all", "--json", "--include-body"],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return parsed;
    return parsed.items ?? parsed.results ?? [];
  } catch {
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

function setupCommands(api: any): void {
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
    async run(ctx: any) {
      const name = optionString(ctx.options, "name") || "World";
      const emoji = optionString(ctx.options, "emoji") || "👋";
      const upper = optionEnabled(ctx.options, "uppercase");
      let message = `${emoji} Hello, ${name}!`;
      if (upper) message = message.toUpperCase();
      // Print human output to stderr; return structured data for --json hosts.
      console.error(message);
      return { message };
    },
  });

  // DEMO: registerCommand — a command that calls back into `pm` (read-only).
  // Uses `failure_hints` (SDK 2026.7.6+) to surface actionable guidance when the
  // command exits non-zero.
  api.registerCommand({
    name: "starter summary",
    description: "Show a quick workspace summary using `pm stats`.",
    intent: "demonstrate calling pm from an extension",
    examples: ["pm starter summary", "pm starter summary --verbose"],
    failure_hints: [
      "Ensure the workspace is initialized: run `pm init` first.",
      "Verify the tracker path is correct with `pm --path <dir> stats`.",
    ],
    flags: [
      { long: "--verbose", description: "Include a per-type breakdown", type: "boolean" },
    ],
    async run(ctx: any) {
      const result = spawnSync("pm", ["--path", ctx.pm_root, "stats", "--json"], {
        encoding: "utf-8",
      });
      if (result.status !== 0) {
        // Throw a CommandError (carrying an exitCode) so the CLI exits non-zero
        // exactly ONCE rather than re-invoking this handler.
        const stderr = result.stderr?.trim() || result.stdout?.trim() || "";
        const hint = stderr ? ` (${stderr.split("\n")[0]})` : "";
        throw new CommandError(
          `pm starter summary: \`pm stats --json\` failed${hint}. ` +
            "Run `pm init` to initialize the workspace, or check `pm --path <dir> stats`.",
          EXIT_CODE.GENERIC_FAILURE,
        );
      }
      let stats: any;
      try {
        stats = JSON.parse(result.stdout);
      } catch {
        throw new CommandError(
          "pm starter summary: could not parse `pm stats --json` output. " +
            "The pm CLI may be an incompatible version; check `pm --version`.",
        );
      }
      if (!isObject(stats)) {
        throw new CommandError("pm starter summary: invalid `pm stats --json` output format.");
      }
      const total = stats.totals?.items ?? 0;
      const byStatus = stats.by_status ?? {};
      console.error(`\n  Workspace Summary\n  =================`);
      console.error(`  Total items: ${total}`);
      for (const [status, count] of Object.entries(byStatus)) {
        if ((count as number) > 0) console.error(`  ${status}: ${count}`);
      }
      if (optionEnabled(ctx.options, "verbose") && stats.by_type) {
        console.error(`\n  By type:`);
        for (const [type, count] of Object.entries(stats.by_type)) {
          if ((count as number) > 0) console.error(`    ${type}: ${count}`);
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
    failure_hints: [
      "The demo reads items via `pm list-all --json`; ensure the workspace is initialized.",
    ],
    async run(ctx: any) {
      const items = readPmItems(ctx.pm_root);
      // Return a small, predictable shape the renderer override can recognize.
      return {
        starter_demo: true,
        item_count: items.length,
        sample: items.slice(0, 3).map((i) => ({ id: i.id, title: i.title, status: i.status })),
      };
    },
  });

  // DEMO: registerCommand — plan workflow command.
  // Calls `pm plan show <id> --json` to demonstrate integration with pm's
  // agent-optimized plan workflow (create, steps, dependencies, approve,
  // materialize). The command is read-only: it fetches a plan and prints a
  // compact summary.
  api.registerCommand({
    name: "starter plan",
    description: "Show a plan item and its steps using `pm plan show`.",
    intent: "demonstrate integration with pm's plan workflow",
    examples: [
      "pm starter plan pm-cli-website-6t9b",
      "pm starter plan pm-cli-website-6t9b --steps",
      "pm starter plan pm-cli-website-6t9b --json",
    ],
    failure_hints: [
      "Provide a valid plan item ID: pm starter plan <id>.",
      "Create a plan first with: pm plan create --title \"My plan\".",
      "The item must be of type Plan; check with: pm get <id>.",
    ],
    arguments: [
      { name: "id", required: true, description: "Plan item ID to inspect" },
    ],
    flags: [
      { long: "--steps", description: "Include a per-step breakdown", type: "boolean" },
    ],
    async run(ctx: any) {
      const planId = ctx.args?.[0] || optionString(ctx.options, "id");
      if (!planId) {
        throw new CommandError(
          "pm starter plan: a plan item ID is required.\n" +
            "  Usage: pm starter plan <id>\n" +
            "  Example: pm starter plan pm-cli-website-6t9b\n" +
            "  Tip: create a plan with `pm plan create --title \"My plan\"`.",
          EXIT_CODE.USAGE,
        );
      }
      const result = spawnSync(
        "pm",
        ["--path", ctx.pm_root, "plan", "show", planId, "--depth", "standard", "--json"],
        { encoding: "utf-8" },
      );
      if (result.status !== 0) {
        const stderr = result.stderr?.trim() || "";
        const detail = stderr ? `: ${stderr.split("\n")[0]}` : "";
        throw new CommandError(
          `pm starter plan: \`pm plan show ${planId}\` failed${detail}. ` +
            `Verify the ID is a Plan item: \`pm get ${planId}\`.`,
          EXIT_CODE.NOT_FOUND,
        );
      }
      let plan: any;
      try {
        plan = JSON.parse(result.stdout);
      } catch {
        throw new CommandError(
          `pm starter plan: could not parse plan output for ${planId}.`,
        );
      }
      if (!isObject(plan)) {
        throw new CommandError(`pm starter plan: invalid plan output format for ${planId}.`);
      }
      const planData = isObject(plan.plan) ? plan.plan : plan;
      const title = planData.title ?? planData.metadata?.title ?? planId;
      const mode = planData.mode ?? planData.metadata?.mode ?? "?";
      const stepsValue = planData.steps ?? planData.metadata?.steps ?? [];
      const steps = Array.isArray(stepsValue) ? stepsValue : [];
      console.error(`\n  Plan: ${title} (${planId})`);
      console.error(`  Mode: ${mode}`);
      console.error(`  Steps: ${steps.length}`);
      if (optionEnabled(ctx.options, "steps") && steps.length > 0) {
        console.error(`\n  Step breakdown:`);
        for (const step of steps) {
          const done = step.status === "completed" || step.completed ? "[x]" : "[ ]";
          console.error(`    ${done} ${step.order ?? "?"}. ${step.title ?? step.id}`);
        }
      }
      return { plan_id: planId, title, mode, step_count: steps.length, steps };
    },
  });

  // DEMO: registerCommand — context snapshot command.
  // Calls `pm context --json` to demonstrate integration with pm's token-efficient
  // project context snapshot, which aggregates focus items, agenda, activity,
  // and next-work recommendations.
  api.registerCommand({
    name: "starter context",
    description: "Show a compact project context snapshot via `pm context`.",
    intent: "demonstrate integration with pm's context snapshot",
    examples: [
      "pm starter context",
      "pm starter context --depth deep",
      "pm starter context --json",
    ],
    failure_hints: [
      "Ensure the workspace is initialized: run `pm init` first.",
      "Context requires at least one item; create one with `pm create`.",
    ],
    flags: [
      { long: "--depth", value_name: "level", description: "Context depth: brief|standard|deep|full", type: "string" },
    ],
    async run(ctx: any) {
      const depth = optionString(ctx.options, "depth");
      const pmArgs = ["--path", ctx.pm_root, "context", "--json"];
      if (depth) pmArgs.push("--depth", depth);
      const result = spawnSync("pm", pmArgs, { encoding: "utf-8" });
      if (result.status !== 0) {
        const stderr = result.stderr?.trim() || "";
        const detail = stderr ? `: ${stderr.split("\n")[0]}` : "";
        throw new CommandError(
          `pm starter context: \`pm context\` failed${detail}. ` +
            "Run `pm init` to initialize the workspace.",
          EXIT_CODE.GENERIC_FAILURE,
        );
      }
      let contextData: any;
      try {
        contextData = JSON.parse(result.stdout);
      } catch {
        throw new CommandError(
          "pm starter context: could not parse `pm context --json` output.",
        );
      }
      if (!isObject(contextData)) {
        throw new CommandError("pm starter context: invalid `pm context --json` output format.");
      }
      // Print a compact human-readable summary.
      const focus = contextData.focus ?? contextData.project_focus ?? contextData.low_level ?? [];
      const agenda = contextData.agenda ?? [];
      const activity = contextData.activity ?? [];
      console.error(`\n  Context Snapshot`);
  console.error(`  ================`);
      console.error(`  Focus items: ${Array.isArray(focus) ? focus.length : 0}`);
      console.error(`  Agenda entries: ${Array.isArray(agenda) ? agenda.length : 0}`);
      console.error(`  Activity entries: ${Array.isArray(activity) ? activity.length : 0}`);
      if (Array.isArray(focus) && focus.length > 0) {
        console.error(`\n  Focus:`);
        for (const item of focus.slice(0, 5)) {
          console.error(`    ${item.id ?? "?"}  ${item.title ?? "(untitled)"}  [${item.status ?? "?"}]`);
        }
      }
      return contextData;
    },
  });

  // DEMO: registerCommand — search command.
  // Calls `pm search --json` to demonstrate integration with pm's keyword,
  // semantic, or hybrid search.
  api.registerCommand({
    name: "starter search",
    description: "Search items via `pm search` and show compact results.",
    intent: "demonstrate integration with pm's search capabilities",
    examples: [
      "pm starter search authentication",
      "pm starter search \"bug fix\" --mode hybrid",
      "pm starter search --mode semantic deployment",
      "pm starter search \"release\" --json",
    ],
    failure_hints: [
      "Provide search keywords: pm starter search <keywords...>.",
      "Valid modes: keyword (default), semantic, hybrid.",
      "Ensure items exist in the workspace; create one with `pm create`.",
    ],
    arguments: [
      { name: "keywords", required: true, variadic: true, description: "Keyword query tokens" },
    ],
    flags: [
      { long: "--mode", value_name: "mode", description: "Search mode: keyword|semantic|hybrid (default: keyword)", type: "string" },
      { long: "--limit", value_name: "n", description: "Max results to display (default: 10)", type: "number" },
    ],
    async run(ctx: any) {
      const keywords = ctx.args ?? [];
      if (keywords.length === 0) {
        throw new CommandError(
          "pm starter search: at least one keyword is required.\n" +
            "  Usage: pm starter search <keywords...>\n" +
            "  Example: pm starter search authentication\n" +
            "  Modes: --mode keyword|semantic|hybrid",
          EXIT_CODE.USAGE,
        );
      }
      const mode = optionString(ctx.options, "mode");
      const limit = optionPositiveInteger(ctx.options, 10, "limit");
      const pmArgs = ["--path", ctx.pm_root, "search", "--json"];
      if (mode) pmArgs.push("--mode", mode);
      pmArgs.push("--", ...keywords);
      const result = spawnSync("pm", pmArgs, { encoding: "utf-8" });
      if (result.status !== 0) {
        const stderr = result.stderr?.trim() || "";
        const detail = stderr ? `: ${stderr.split("\n")[0]}` : "";
        throw new CommandError(
          `pm starter search: \`pm search\` failed${detail}.`,
          EXIT_CODE.GENERIC_FAILURE,
        );
      }
      let searchResult: any;
      try {
        searchResult = JSON.parse(result.stdout);
      } catch {
        throw new CommandError(
          "pm starter search: could not parse `pm search --json` output.",
        );
      }
      if (!isObject(searchResult)) {
        throw new CommandError("pm starter search: invalid `pm search --json` output format.");
      }
      const hitsValue = searchResult.hits ?? searchResult.results ?? searchResult.items ?? [];
      const hits = Array.isArray(hitsValue) ? hitsValue : [];
      console.error(`\n  Search Results (${hits.length} hit(s))`);
      console.error(`  =======================`);
      for (const hit of hits.slice(0, limit)) {
        const id = hit.id ?? "?";
        const score = typeof hit.score === "number" ? hit.score.toFixed(2) : "?";
        const title = hit.title ?? "(untitled)";
        console.error(`    ${id}  [${score}]  ${title}`);
      }
      if (hits.length === 0) {
        console.error(`  No results. Try a different query or mode.`);
        console.error(`  Tip: use --mode hybrid for broader retrieval.`);
      }
      return { query: keywords.join(" "), mode: mode || "keyword", hits, total: hits.length };
    },
  });

  // DEMO: registerCommand — interactive guided setup.
  // The --interactive flag walks the user through configuring their extension
  // scaffold step by step. This demonstrates the guided setup pattern.
  api.registerCommand({
    name: "starter setup",
    description: "Guided setup helper for scaffolding a new pm extension.",
    intent: "demonstrate the --interactive guided-setup flag pattern",
    examples: [
      "pm starter setup --interactive",
      "pm starter setup --name my-ext --capability commands",
      "pm starter setup --name my-ext --capability commands,search,hooks",
    ],
    failure_hints: [
      "Provide a name: pm starter setup --name <name>.",
      "Use --interactive for step-by-step guided setup.",
    ],
    flags: [
      { long: "--interactive", description: "Run an interactive guided setup wizard", type: "boolean" },
      { long: "--name", value_name: "name", description: "Extension name (e.g. my-ext)", type: "string" },
      { long: "--capability", value_name: "caps", description: "Comma-separated capabilities to scaffold (e.g. commands,search)", type: "string" },
    ],
    async run(ctx: any) {
      const interactive = optionEnabled(ctx.options, "interactive");
      const name = optionString(ctx.options, "name");
      const capabilityInput = optionString(ctx.options, "capability");

      if (interactive) {
        // Interactive mode: emit a guided checklist the user/agent can follow.
        console.error("\n  pm-starter Interactive Setup Wizard");
        console.error("  ===================================");
        console.error("");
        console.error("  This wizard will guide you through scaffolding a new pm extension.");
        console.error("");
        console.error("  Step 1: Choose an extension name");
        console.error("    pm starter setup --name <your-extension-name>");
        console.error("");
        console.error("  Step 2: Choose capabilities to include");
        console.error("    Available: commands, renderers, hooks, schema, importers, search, parser, preflight, services");
        console.error("    pm starter setup --name <name> --capability commands,search");
        console.error("");
        console.error("  Step 3: Scaffold your extension");
        console.error("    1. Clone: git clone https://github.com/unbraind/pm-starter.git <name>");
        console.error("    2. Edit manifest.json: update name, description, capabilities");
        console.error("    3. Edit index.ts: keep only the setup* functions for your capabilities");
        console.error("    4. Edit package.json: update name and version");
        console.error("    5. Build: npm install && npm run build");
        console.error("    6. Install: pm install ./<name> --project");
        console.error("");
        console.error("  Step 4: Verify");
        console.error("    pm extension doctor   # check for collisions");
        console.error("    pm <name> greet       # smoke test");
        console.error("");
        return { interactive: true, steps: ["name", "capability", "scaffold", "verify"] };
      }

      if (!name) {
        throw new CommandError(
          "pm starter setup: --name is required (or use --interactive for guided setup).\n" +
            "  Usage: pm starter setup --name <name> --capability <caps>\n" +
            "  Example: pm starter setup --name my-ext --capability commands,search\n" +
            "  Interactive: pm starter setup --interactive",
          EXIT_CODE.USAGE,
        );
      }

      const capabilities = capabilityInput
        ? capabilityInput.split(",").map((c) => c.trim()).filter(Boolean)
        : ["commands"];

      const validCaps = ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"];
      const invalid = capabilities.filter((c) => !validCaps.includes(c));
      if (invalid.length > 0) {
        throw new CommandError(
          `pm starter setup: invalid capability '${invalid[0]}'.\n` +
            `  Valid capabilities: ${validCaps.join(", ")}`,
          EXIT_CODE.USAGE,
        );
      }

      console.error(`\n  Extension Scaffold Plan`);
      console.error(`  =======================`);
      console.error(`  Name: ${name}`);
      console.error(`  Capabilities: ${capabilities.join(", ")}`);
      console.error(`\n  Files to edit:`);
      console.error(`    1. manifest.json  -> name: "${name}", capabilities: [${capabilities.map((c) => `"${c}"`).join(", ")}]`);
      console.error(`    2. index.ts       -> keep setup* functions for: ${capabilities.join(", ")}`);
      console.error(`    3. package.json   -> name: "${name}"`);
      console.error(`\n  Next steps:`);
      console.error(`    npm install && npm run build`);
      console.error(`    pm install ./${name} --project`);
      console.error(`    pm extension doctor`);

      return { name, capabilities, scaffolded: false, interactive: false };
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

function setupRenderers(api: any): void {
  // DEMO: registerRenderer("json") — reshape ONLY our own `starter demo`
  // payload. A renderer override is registered per-format and is invoked for
  // EVERY command using that format, so for anything that isn't our payload we
  // return a non-string (null): pm then falls through to its native renderer
  // and no other command's output is altered. This is the safe pattern — never
  // globally hijack toon/json output from a shared extension.
  api.registerRenderer("json", (ctx: any) => {
    const result = ctx.result;
    if (result && typeof result === "object" && (result as any).starter_demo) {
      return JSON.stringify({ rendered_by: "pm-starter", ...result }, null, 2);
    }
    return null as any; // not ours → native rendering
  });

  // DEMO: registerRenderer("toon") — a compact line view for OUR payload only;
  // null for everything else so native TOON rendering is preserved.
  api.registerRenderer("toon", (ctx: any) => {
    const result = ctx.result;
    if (result && typeof result === "object" && (result as any).starter_demo) {
      const r = result as any;
      const lines = [`pm-starter demo — ${r.item_count} item(s)`];
      for (const s of r.sample ?? []) lines.push(`  ${s.id}\t${s.status}\t${s.title}`);
      return lines.join("\n");
    }
    return null as any; // not ours → native rendering
  });
}

// ---------------------------------------------------------------------------
// DEMO: hooks (all five)
//
// Hooks are observe-only here. They print to stderr only when the opt-in
// env var PM_STARTER_HOOKS is set, so installing the reference extension never
// adds noise to an unrelated workspace.
// ---------------------------------------------------------------------------

function setupHooks(api: any): void {
  const enabled = () => Boolean(process.env.PM_STARTER_HOOKS);
  const log = (msg: string) => { if (enabled()) console.error(`[pm-starter] ${msg}`); };

  // DEMO: hooks.beforeCommand — runs before any command handler.
  api.hooks.beforeCommand((ctx: any) => {
    log(`beforeCommand: ${ctx.command} ${(ctx.args ?? []).join(" ")}`.trimEnd());
  });

  // DEMO: hooks.afterCommand — runs after a command, with ok/error/result.
  api.hooks.afterCommand((ctx: any) => {
    log(`afterCommand: ${ctx.command} -> ${ctx.ok ? "ok" : `error: ${ctx.error ?? "?"}`}`);
  });

  // DEMO: hooks.onWrite — fires when pm writes an item file to disk.
  api.hooks.onWrite((ctx: any) => {
    log(`onWrite: ${ctx.op} ${ctx.scope} ${ctx.path}`);
  });

  // DEMO: hooks.onRead — fires when pm reads an item file.
  api.hooks.onRead((ctx: any) => {
    log(`onRead: ${ctx?.path ?? "(item)"}`);
  });

  // DEMO: hooks.onIndex — fires when pm (re)indexes items for search.
  api.hooks.onIndex((ctx: any) => {
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

function setupSchema(api: any): void {
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
    up(_ctx: any) {
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

function setupImportExport(api: any): void {
  // DEMO: registerImporter — `pm starter-demo import`.
  // Inert by design: it describes what a real importer WOULD do and returns a
  // dry-run-style summary. Swap the body for real parse + `pm create` calls.
  api.registerImporter("starter-demo", async (ctx: any) => {
    const source = optionString(ctx.options || {}, "file", "url") || "(no source given)";
    console.error(
      `[pm-starter] DEMO importer: would import from ${source}. ` +
        "This reference importer is inert — implement parse + `pm create` here.",
    );
    return { imported: 0, dryRun: true, source };
  });

  // DEMO: registerExporter — `pm starter-demo export`.
  // Read-only: serializes the current items to a compact JSON payload and
  // prints it (or returns it for --json hosts). Never writes to disk.
  api.registerExporter("starter-demo", async (ctx: any) => {
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

function setupSearch(api: any): void {
  // DEMO: registerSearchProvider — a simple, dependency-free substring matcher
  // over title + body. Reads items via `pm` and filters in-process.
  api.registerSearchProvider({
    name: "starter-substring",
    async query(ctx: any) {
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
  const store = new Map<string, number[]>();
  const pseudoEmbed = (text: string, dims = 8): number[] => {
    const vec = new Array(dims).fill(0);
    for (let i = 0; i < text.length; i++) vec[i % dims] += text.charCodeAt(i) % 17;
    return vec;
  };
  api.registerVectorStoreAdapter({
    name: "starter-memory",
    async upsert(ctx: any) {
      const id = String(ctx?.id ?? "");
      const text = String(ctx?.text ?? ctx?.title ?? "");
      if (id) store.set(id, pseudoEmbed(text));
      return { upserted: id ? 1 : 0 };
    },
    async query(ctx: any) {
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

function setupParser(api: any): void {
  // DEMO: registerParser — identity pass-through for the native `list` command.
  api.registerParser("list", (ctx: any) => {
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

function setupPreflight(api: any): void {
  // DEMO: registerPreflight — pass-through decision (no behavior change).
  api.registerPreflight((ctx: any) => {
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

function setupServices(api: any): void {
  // DEMO: registerService — a TRUE pass-through for the "output_format"
  // service. A service override replaces a core service for the whole CLI, so
  // the only safe demonstration is to return the incoming payload UNCHANGED
  // (returning a fabricated value here would corrupt every command's output).
  api.registerService("output_format", (ctx: any) => {
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

function setupFlags(api: any): void {
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
  version: "2026.7.11",

  activate(api: any) {
    // Register every capability group. Each helper is defensive enough to be
    // safely deleted when you fork this scaffold for a real extension.
    setupCommands(api);       // registerCommand
    setupRenderers(api);      // registerRenderer (toon|json)
    setupHooks(api);          // hooks.before/after/onWrite/onRead/onIndex
    setupSchema(api);         // registerItemFields/registerItemTypes/registerMigration
    setupImportExport(api);   // registerImporter/registerExporter
    setupSearch(api);         // registerSearchProvider/registerVectorStoreAdapter
    setupParser(api);         // registerParser
    setupPreflight(api);      // registerPreflight
    setupServices(api);       // registerService
    setupFlags(api);          // registerFlags
  },
});

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

import type { ExtensionModule } from "@unbrained/pm-cli/sdk/authoring";
import { spawnSync } from "node:child_process";

import type {
  AfterCommandHookContext,
  BeforeCommandHookContext,
  CommandHandlerContext,
  ExtensionApi,
  ImportExportContext,
  OnIndexHookContext,
  OnReadHookContext,
  OnWriteHookContext,
  PreflightOverrideContext,
  ParserOverrideContext,
  RendererOverrideContext,
  SearchProviderQueryContext,
  ServiceOverrideContext,
  SchemaMigrationRunContext,
  VectorStoreQueryContext,
  VectorStoreUpsertContext,
} from "@unbrained/pm-cli/sdk";

// Standalone-installed extensions load ONLY their own `dist/` at runtime, so
// `@unbrained/pm-cli` is not resolvable as a runtime value. We therefore use the
// zero-runtime-coupling pattern: import `defineExtension` as a TYPE only and
// provide a trivial identity implementation. The real CLI supplies the live
// `api` object at activation time.

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

/**
 * Semantic exit codes this package throws via {@link CommandError}.
 *
 * Mirrored from the SDK contract rather than imported, because a
 * standalone-installed extension cannot resolve the SDK at runtime. pm's command
 * runtime only honors a thrown error's numeric `exitCode`, so mapping a failure
 * to one of these is what produces a clean, semantic non-zero exit instead of a
 * generic one.
 */
export const EXIT_CODE = {
  GENERIC_FAILURE: 1,
  USAGE: 2,
  NOT_FOUND: 3,
} as const;
// NOTE: NOT_FOUND is used by `starter plan` when a plan ID does not exist,
// and USAGE is used by `starter plan`, `starter search`, and `starter setup`
// when required arguments are missing.

/**
 * Error type that carries the numeric exit code pm's command runtime expects.
 *
 * pm's extension runtime re-invokes the handler and exits with a generic code
 * for a thrown {@link Error}; only an error exposing a numeric `exitCode` is
 * treated as a cleanly-handled, semantic non-zero exit (see {@link EXIT_CODE}).
 * Every intentional failure path in this package therefore throws a
 * {@link CommandError}.
 */
export class CommandError extends Error {
  /** Numeric exit code pm's runtime reads off the thrown error (see {@link EXIT_CODE}). */
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read a nested value out of already-parsed, untrusted `pm --json` output.
 *
 * The demos consume JSON produced by whichever pm build the user has installed,
 * so its shape is an assumption rather than a guarantee. Walking it returns
 * `undefined` at the first non-object hop instead of asserting a type that a
 * different CLI version may not produce.
 */
function readPath(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Read a nested string, falling back when the path is absent or not a string. */
function readString(value: unknown, keys: string[], fallback: string): string {
  const found = readPath(value, ...keys);
  return typeof found === "string" ? found : fallback;
}

// Node's spawnSync defaults to a 1 MiB stdout cap, which a mature tracker's JSON
// dump passes at a few hundred items. Past that the child is killed with ENOBUFS,
// status null and EMPTY stderr, so the failure surfaces with nothing to diagnose
// (and at larger sizes stdout is genuinely truncated mid-document).
// 64 MiB matches the cap the sibling pm packages settled on.
/** Read-buffer cap for `pm` output, in bytes. 64 MiB by default; override with the
 * `PM_JSON_MAX_BUFFER` env var. Resolved per call so the override takes effect
 * without an import-order dependency. Invalid or non-positive values fall back to
 * the default rather than silently disabling the guard. */
function pmJsonMaxBuffer(): number {
  // Number(), not parseInt(): parseInt("64MiB") silently yields 64, which would
  // impose a 64-BYTE cap and break every ordinary read while appearing to honor
  // the documented invalid-value fallback. Number() rejects the whole string.
  const raw = Number(process.env.PM_JSON_MAX_BUFFER);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 64 * 1024 * 1024;
}

/** Name the real cause of a failed `pm` read. A stdout overrun kills the child
 * with `status: null` and EMPTY stderr, so without this the failure surfaces as
 * an unexplained error (or, worse, as an empty result set). */
function describePmReadFailure(error: Error, limitBytes: number): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOBUFS") {
    // This read is always the full workspace, so "narrow the operation" would be a
    // dead instruction here — name only the lever the reader actually has.
    return `pm output exceeded the ${limitBytes} byte read buffer. `
      + "Raise PM_JSON_MAX_BUFFER (in bytes) to increase the read limit for this workspace.";
  }
  return `pm read failed: ${error.message}`;
}

/**
 * The outcome of a workspace read: either the rows, or the reason there are none.
 *
 * A bare `Array` return cannot express this. `[]` is also the correct answer for
 * a genuinely empty workspace, so every caller that received `[]` had to guess,
 * and all of them guessed "empty" — the demo reported `item_count: 0` and the
 * exporter emitted `[]` with `exported: 0`, both announcing success for a read
 * that failed. Logging the cause to stderr does not help, because a return value
 * is what the caller branches on. Discriminating the two cases is what lets a
 * failed read stay failed all the way to the exit code.
 */
export type PmReadOutcome =
  | { readonly ok: true; readonly items: Array<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string };

/**
 * Safely read all items from the workspace by shelling out to `pm`.
 *
 * Never throws, so demos cannot blow up at activation/read time — but it also
 * never reports a failed read as an empty workspace. Every failure path returns
 * `{ ok: false, reason }` naming what went wrong, and callers turn that into a
 * {@link CommandError} rather than rendering it as "no items". This is the SAFE
 * read pattern every demo reuses.
 *
 * @param pmRoot - Workspace root passed through to `pm --path`.
 * @returns The rows on a proven-complete read, or the reason the read failed.
 */
export function readPmItems(pmRoot: string): PmReadOutcome {
  const maxBuffer = pmJsonMaxBuffer();
  const result = spawnSync(
    "pm",
    ["--path", pmRoot, "list-all", "--json", "--include-body"],
    { encoding: "utf-8", maxBuffer },
  );
  if (result.error) {
    return { ok: false, reason: describePmReadFailure(result.error, maxBuffer) };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `pm exited ${result.status} — ${result.stderr?.trim() || "no stderr output"}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    // Kept separate from the incompleteness check below so the diagnostic names
    // the actual failure: unparseable output is a different problem from a
    // parsed envelope that admits it is partial.
    return {
      ok: false,
      reason: `could not parse \`pm list-all --json\` output: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // A bare array carries no completeness receipt, so it cannot prove it is the
  // whole workspace — and an unprovable answer is exactly what this reader
  // exists to refuse. Accepting it would leave a legacy-shaped partial response
  // as an open bypass around every check below.
  if (Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "`pm list-all --json` returned a bare array, which carries no completeness receipt to verify",
    };
  }
  // Anything that is not an object carries no receipt either, and
  // `describeListAllIncompleteness` answers `null` for every non-object — so
  // without this check a payload of `null`, `false`, `42` or `"text"` would
  // fall through to an absent rows field and be reported as a successful empty
  // workspace. That is the bare-array fail-open one shape over.
  if (!isObject(parsed)) {
    return {
      ok: false,
      reason: `\`pm list-all --json\` returned ${parsed === null ? "null" : typeof parsed}, which carries no completeness receipt to verify`,
    };
  }
  const incomplete = describeListAllIncompleteness(parsed);
  if (incomplete) {
    // A truncated or degraded envelope is a FAILED read that looks like a
    // successful one: `items` is present and parses, so without this check the
    // demo renders a partial workspace and reports success.
    return { ok: false, reason: `refusing an incomplete pm read — ${incomplete}` };
  }
  const rows = readPath(parsed, "items") ?? readPath(parsed, "results");
  if (rows === undefined) return { ok: true, items: [] };
  if (!Array.isArray(rows)) {
    return { ok: false, reason: "`pm list-all --json` returned a non-array rows field" };
  }
  // Dropping unusable rows would contradict everything above: the receipt said
  // this answer is the whole workspace, so silently returning fewer rows than it
  // contains is a partial read reported as a complete one — the exact failure
  // this reader exists to refuse, arriving through the row payload instead of
  // through the receipt.
  const unusable = rows.findIndex((row) => !isObject(row));
  if (unusable !== -1) {
    return {
      ok: false,
      reason: `\`pm list-all --json\` returned an unusable row at index ${unusable} (${rows[unusable] === null ? "null" : typeof rows[unusable]}); the receipt claimed a complete answer, so dropping it would report a shortened workspace as complete`,
    };
  }
  return { ok: true, items: rows as Array<Record<string, unknown>> };
}

/**
 * Read the workspace or fail the command, so a failed read never renders as an
 * empty one.
 *
 * @param pmRoot - Workspace root passed through to `pm --path`.
 * @returns The rows of a proven-complete read.
 * @throws {CommandError} With {@link EXIT_CODE.GENERIC_FAILURE} when the read failed.
 */
function readPmItemsOrFail(pmRoot: string): Array<Record<string, unknown>> {
  const outcome = readPmItems(pmRoot);
  if (!outcome.ok) {
    throw new CommandError(`pm-starter: could not read pm items — ${outcome.reason}`, EXIT_CODE.GENERIC_FAILURE);
  }
  return outcome.items;
}

/**
 * Render one count field for the scale suffix, tolerating a field the installed
 * CLI does not emit or emits as something other than a number.
 */
function readCount(envelope: unknown, key: string): string {
  const value = readPath(envelope, key);
  return typeof value === "number" ? String(value) : "?";
}

/**
 * Name the reason a `pm list-all` envelope is not the whole workspace, or
 * return `null` when it is complete.
 *
 * The envelope has carried a completeness receipt since 2026.8.15, and reading
 * `.items` without consulting it is how a partial answer becomes a
 * successful-looking result. That is not hypothetical: pm-cli 2026.8.14 returned
 * 10 items of a 682-item workspace with `truncated: true`, and every consumer
 * that ignored the receipt reported success on 1.5% of the data.
 *
 * Four independent signals each mean "the rows you got are not all the rows".
 * A missing `completeness` object counts as incomplete rather than complete: an
 * answer that cannot be verified is not a verified answer, and treating absence
 * as success is the same mistake one level up.
 *
 * @param envelope - Parsed `pm list-all --json` output.
 * @returns A human-readable reason naming the tripped signal and the
 *          count-versus-total figures, or `null` if the answer is complete.
 */
export function describeListAllIncompleteness(envelope: unknown): string | null {
  // A non-object, or a bare ARRAY, carries no receipt to contradict — and an
  // array is `typeof "object"`, so it must be excluded explicitly or the check
  // reports every array as "completeness absent". `readPmItems` already handles
  // the array shape on its own line above; only an ENVELOPE can claim to be
  // incomplete.
  if (!isObject(envelope)) return null;
  // Every field below is read through `readPath` rather than asserted with a
  // cast. These values come from whichever pm build the user has installed, so
  // their types are an assumption, not a guarantee — and a cast that turns out
  // to be wrong fails the comparison silently, which for a completeness receipt
  // means reporting "complete" for an answer that never claimed to be.
  const scale = `${readCount(envelope, "count")} of ${readCount(envelope, "total")} item(s) returned`;
  if (readPath(envelope, "truncated") === true) return `the row list was truncated (${scale})`;
  if (readPath(envelope, "has_more") === true) return `more rows exist past the returned page (${scale})`;
  const status = readPath(envelope, "completeness", "status");
  if (status !== "complete") {
    // Anything that is not the literal string "complete" is treated as
    // incomplete, including a non-string the cast would previously have let
    // through untyped.
    const described = status === undefined ? "absent" : JSON.stringify(status);
    return `completeness.status is ${described}, not "complete" (${scale})`;
  }
  if (readPath(envelope, "omission_receipt", "has_omissions") === true) {
    return `field groups were omitted from the projection (${scale})`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// DEMO: commands (registerCommand)
//
// Three commands, all under the `pm starter ...` namespace so they never
// collide with the importer/exporter command paths (`pm starter-demo ...`).
// `greet` and `summary` are kept for backward compatibility.
// ---------------------------------------------------------------------------

/**
 * Register the `pm starter ...` demo commands onto the extension API.
 *
 * Wires up the self-contained demo commands (the `starter greet` flag demo plus
 * the back-compat `greet`/`summary` commands) under the `starter` namespace so
 * they never collide with the importer/exporter paths. This is the
 * `registerCommand` reference; because the command declares flags, the manifest
 * must also advertise the `schema` capability.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupCommands(api: ExtensionApi): void {
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
    async run(ctx: CommandHandlerContext) {
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
    async run(ctx: CommandHandlerContext) {
      const result = spawnSync("pm", ["--path", ctx.pm_root, "stats", "--json"], {
        encoding: "utf-8",
        maxBuffer: pmJsonMaxBuffer(),
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
      let stats: unknown;
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
      const totalValue = readPath(stats, "totals", "items");
      const total = typeof totalValue === "number" ? totalValue : 0;
      const byStatus = isObject(stats.by_status) ? stats.by_status : {};
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
    async run(ctx: CommandHandlerContext) {
      const items = readPmItemsOrFail(ctx.pm_root);
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
    async run(ctx: CommandHandlerContext) {
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
        { encoding: "utf-8", maxBuffer: pmJsonMaxBuffer() },
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
      let plan: unknown;
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
      const title = readString(planData, ["title"], readString(planData, ["metadata", "title"], planId));
      const mode = readString(planData, ["mode"], readString(planData, ["metadata", "mode"], "?"));
      const stepsValue = readPath(planData, "steps") ?? readPath(planData, "metadata", "steps") ?? [];
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
    async run(ctx: CommandHandlerContext) {
      const depth = optionString(ctx.options, "depth");
      const pmArgs = ["--path", ctx.pm_root, "context", "--json"];
      if (depth) pmArgs.push("--depth", depth);
      const result = spawnSync("pm", pmArgs, { encoding: "utf-8", maxBuffer: pmJsonMaxBuffer() });
      if (result.status !== 0) {
        const stderr = result.stderr?.trim() || "";
        const detail = stderr ? `: ${stderr.split("\n")[0]}` : "";
        throw new CommandError(
          `pm starter context: \`pm context\` failed${detail}. ` +
            "Run `pm init` to initialize the workspace.",
          EXIT_CODE.GENERIC_FAILURE,
        );
      }
      let contextData: unknown;
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
    async run(ctx: CommandHandlerContext) {
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
      const result = spawnSync("pm", pmArgs, { encoding: "utf-8", maxBuffer: pmJsonMaxBuffer() });
      if (result.status !== 0) {
        const stderr = result.stderr?.trim() || "";
        const detail = stderr ? `: ${stderr.split("\n")[0]}` : "";
        throw new CommandError(
          `pm starter search: \`pm search\` failed${detail}.`,
          EXIT_CODE.GENERIC_FAILURE,
        );
      }
      let searchResult: unknown;
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
    async run(ctx: CommandHandlerContext) {
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

/** Result shape emitted by the `starter demo` command that the renderers reshape. */
interface StarterDemoResult {
  starter_demo: true;
  item_count?: number;
  sample?: unknown[];
}

/** Determine whether an unknown command result is a `starter demo` payload. */
function isStarterDemoResult(value: unknown): value is StarterDemoResult {
  return isObject(value) && value.starter_demo === true;
}

/**
 * Register the demo item renderers onto the extension API.
 *
 * Demonstrates `registerRenderer` for the `json` and `toon` formats, each
 * reshaping only this package's own `starter demo` payload. An ownership object
 * (command path + {@link isStarterDemoResult} discriminator) makes the host
 * enforce the scope, and each callback returns `null` for anything else as
 * defence in depth so native rendering is preserved.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupRenderers(api: ExtensionApi): void {
  // DEMO: registerRenderer("json") — reshape ONLY our own `starter demo`
  // payload. The ownership object below makes the host enforce the command
  // path and result discriminator before the callback runs, so an unrelated
  // command never reaches it. The runtime null return stays as defence in
  // depth: ownership is enforced by the host, the null return by the package.
  const rendererOwnership = {
    commands: ["starter demo"],
    resultDiscriminator: isStarterDemoResult,
  };

  api.registerRenderer("json", (ctx: RendererOverrideContext) => {
    const result = ctx.result;
    if (isStarterDemoResult(result)) {
      return JSON.stringify({ rendered_by: "pm-starter", ...result }, null, 2);
    }
    return null; // not ours → native rendering
  }, rendererOwnership);

  // DEMO: registerRenderer("toon") — a compact line view for OUR payload only;
  // null for everything else so native TOON rendering is preserved.
  api.registerRenderer("toon", (ctx: RendererOverrideContext) => {
    const result = ctx.result;
    if (isStarterDemoResult(result)) {
      const lines = [`pm-starter demo — ${String(result.item_count ?? 0)} item(s)`];
      const sample = Array.isArray(result.sample) ? result.sample : [];
      for (const entry of sample) {
        lines.push(`  ${readString(entry, ["id"], "?")}\t${readString(entry, ["status"], "?")}\t${readString(entry, ["title"], "?")}`);
      }
      return lines.join("\n");
    }
    return null; // not ours → native rendering
  }, rendererOwnership);
}

// ---------------------------------------------------------------------------
// DEMO: hooks (all five)
//
// Hooks are observe-only here. They print to stderr only when the opt-in
// env var PM_STARTER_HOOKS is set, so installing the reference extension never
// adds noise to an unrelated workspace.
// ---------------------------------------------------------------------------

/**
 * Register the five demo lifecycle hooks onto the extension API.
 *
 * Demonstrates every hook point as observe-only: each prints to stderr solely
 * when the opt-in `PM_STARTER_HOOKS` env var is set, so installing the reference
 * extension adds no noise to an unrelated workspace.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupHooks(api: ExtensionApi): void {
  const enabled = () => Boolean(process.env.PM_STARTER_HOOKS);
  const log = (msg: string) => { if (enabled()) console.error(`[pm-starter] ${msg}`); };

  // DEMO: hooks.beforeCommand — runs before any command handler.
  api.hooks.beforeCommand((ctx: BeforeCommandHookContext) => {
    log(`beforeCommand: ${ctx.command} ${(ctx.args ?? []).join(" ")}`.trimEnd());
  });

  // DEMO: hooks.afterCommand — runs after a command, with ok/error/result.
  api.hooks.afterCommand((ctx: AfterCommandHookContext) => {
    log(`afterCommand: ${ctx.command} -> ${ctx.ok ? "ok" : `error: ${ctx.error ?? "?"}`}`);
  });

  // DEMO: hooks.onWrite — fires when pm writes an item file to disk.
  api.hooks.onWrite((ctx: OnWriteHookContext) => {
    log(`onWrite: ${ctx.op} ${ctx.scope} ${ctx.path}`);
  });

  // DEMO: hooks.onRead — fires when pm reads an item file.
  api.hooks.onRead((ctx: OnReadHookContext) => {
    log(`onRead: ${ctx?.path ?? "(item)"}`);
  });

  // DEMO: hooks.onIndex — fires when pm (re)indexes items for search.
  api.hooks.onIndex((ctx: OnIndexHookContext) => {
    log(`onIndex: mode=${ctx.mode} total_items=${ctx.total_items ?? "(unreported)"}`);
  });
}

// ---------------------------------------------------------------------------
// DEMO: schema (registerItemFields + registerItemTypes + registerMigration)
//
// All three are declarative and additive. They teach the workspace about new
// fields/types and a no-op migration; nothing is mutated until a user opts in
// by creating items of the new type.
// ---------------------------------------------------------------------------

/**
 * Register the demo item-field, item-type, and migration declarations.
 *
 * Demonstrates the three additive, declarative schema calls —
 * `registerItemFields`, `registerItemTypes`, and `registerMigration` — which
 * teach the workspace about new fields/types and a no-op migration. Nothing is
 * mutated until a user opts in by creating items of the new type.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupSchema(api: ExtensionApi): void {
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
    up(_ctx: SchemaMigrationRunContext) {
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

/**
 * Register the demo importer and exporter under the `starter-demo` name.
 *
 * Demonstrates `registerImporter`/`registerExporter`, creating
 * `pm starter-demo import` and `pm starter-demo export`. Both are inert by
 * design: the importer only previews (the committing `--commit` path is
 * deliberately omitted so the reference never writes), and the exporter only
 * reads and prints.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupImportExport(api: ExtensionApi): void {
  // DEMO: registerImporter — `pm starter-demo import`.
  // Inert by design: it describes what a real importer WOULD do and returns a
  // dry-run-style summary. Swap the body for real parse + `pm create` calls.
  api.registerImporter("starter-demo", async (ctx: ImportExportContext) => {
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
  api.registerExporter("starter-demo", async (ctx: ImportExportContext) => {
    const items = readPmItemsOrFail(ctx.pm_root);
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

/**
 * Register the demo search provider and vector-store adapter.
 *
 * Demonstrates `registerSearchProvider` and `registerVectorStoreAdapter`, the
 * two search-extension hook points, as inert reference wiring.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupSearch(api: ExtensionApi): void {
  // DEMO: registerSearchProvider — a dependency-free substring matcher over
  // title + body. `SearchProviderQueryContext` already carries the workspace's
  // documents, so a provider never reads the tracker itself; an earlier version
  // spawned a `pm` subprocess per query for data the host had already supplied.
  api.registerSearchProvider({
    name: "starter-substring",
    query(ctx: SearchProviderQueryContext) {
      const q = ctx.query.toLowerCase();
      if (!q) return { hits: [] };
      // The contract is `SearchProviderHit[] | { hits }`: a hit is an
      // { id, score } pair, not a raw item. Returning items under a `results`
      // key yields zero hits for every caller.
      const hits = ctx.documents.flatMap((document) => {
        const haystack = `${document.metadata.title ?? ""} ${document.body}`.toLowerCase();
        return haystack.includes(q)
          ? [{ id: document.metadata.id, score: 1, matched_fields: ["title", "body"] }]
          : [];
      });
      return { hits };
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
    upsert(ctx: VectorStoreUpsertContext) {
      const id = String(ctx?.id ?? "");
      const text = String(ctx?.text ?? ctx?.title ?? "");
      if (id) store.set(id, pseudoEmbed(text));
      return { upserted: id ? 1 : 0 };
    },
    query(ctx: VectorStoreQueryContext) {
      // Return nearest by simple dot-product over the in-memory vectors.
      const qVec = pseudoEmbed(String(ctx?.query ?? ""));
      const scored = [...store.entries()].map(([id, v]) => ({
        id,
        // qVec and every stored vector are both length 8 from pseudoEmbed,
        // so qVec[i] is always defined for i in 0..7 — no ?? 0 guard needed.
        score: v.reduce((s, x, i) => s + x * qVec[i], 0),
      }));
      scored.sort((a, b) => b.score - a.score);
      // VectorStoreQueryHit[] is a bare array — wrapping it in an object
      // typechecked as `any` before and returned nothing usable to pm.
      return scored.slice(0, ctx?.limit ?? 5);
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

/**
 * Register the demo argument-parser override for the native `list` command.
 *
 * Demonstrates `registerParser`: a parser override can pre-normalize args and
 * options for a native command before its handler runs. This one attaches to
 * `list` and passes everything through unchanged — a safe identity transform so
 * the reference never alters real behavior.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupParser(api: ExtensionApi): void {
  // DEMO: registerParser — identity pass-through for the native `list` command.
  api.registerParser("list", (ctx: ParserOverrideContext) => {
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

/**
 * Register the demo preflight override.
 *
 * Demonstrates `registerPreflight`: a preflight override can adjust the gate
 * decisions the CLI makes before a command runs. This one returns a conservative
 * pass-through that preserves the runtime's existing decision (or sane
 * defaults), changing nothing.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupPreflight(api: ExtensionApi): void {
  // DEMO: registerPreflight — pass-through decision (no behavior change).
  api.registerPreflight((ctx: PreflightOverrideContext) => {
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
// We override "output_format" with an inert pass-through that declines every
// payload, demonstrating the hook point without changing any command's output.
// ---------------------------------------------------------------------------

/**
 * Register the demo service override for the `output_format` service.
 *
 * Demonstrates `registerService`: a service override lets an extension supply or
 * augment a named internal service. This one overrides `output_format` with an
 * inert pass-through that declines every payload, showing the hook point without
 * changing any command's output.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupServices(api: ExtensionApi): void {
  // DEMO: registerService — a TRUE pass-through for the "output_format"
  // service. A service override replaces a core service for the whole CLI, so
  // the only safe demonstration is to decline the payload and let the host
  // render it exactly as it would without this extension.
  //
  // Declining MUST return the `{ handled: false }` decision. Returning the
  // inbound `ctx.payload` is NOT a pass-through: as of @unbrained/pm-cli
  // 2026.7.27 an override's bare return value IS what the host renders, so
  // echoing the payload makes EVERY command print the whole command context
  // (`global`, `format`, `options`, …) instead of its own result.
  //
  // The SDK ships `declineServiceOverride()` (sdk/authoring) which returns
  // exactly this object, but it is a runtime value and a standalone-installed
  // extension cannot resolve the SDK at runtime (see the note at the top of this
  // file), so the decision is written as a literal. The matching
  // `ServiceOverrideDecision` type is not part of the public SDK surface.
  api.registerService("output_format", (_ctx: ServiceOverrideContext) => ({ handled: false }));
}

// ---------------------------------------------------------------------------
// DEMO: flags (registerFlags)
//
// registerFlags adds extra flags to an EXISTING native command (here, `list`).
// The flag is observe-only: native `list` ignores unknown options, and our
// parser/hook demos don't act on it — it exists purely to show the wiring.
// ---------------------------------------------------------------------------

/**
 * Register the demo extra flag onto the native `list` command.
 *
 * Demonstrates `registerFlags`, which adds flags to an existing native command.
 * The added flag is observe-only: native `list` ignores unknown options, and the
 * parser/hook demos don't act on it, so it exists purely to show the wiring.
 *
 * @param api - The extension API surface passed to `activate`.
 */
function setupFlags(api: ExtensionApi): void {
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

/**
 * Local stand-in for the SDK's `defineExtension` identity helper.
 *
 * Declared here rather than imported so this package keeps a type-only
 * dependency on `@unbrained/pm-cli` and adds no runtime module edge. The
 * generic constraint is the SDK's own, so the extension object is contract-
 * checked against {@link ExtensionModule} exactly as the imported helper would.
 */
const defineExtension = <TModule extends ExtensionModule>(module: TModule): TModule => module;

export default defineExtension({
  name: "pm-starter",
  version: "2026.8.16",

  activate(api: ExtensionApi) {
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

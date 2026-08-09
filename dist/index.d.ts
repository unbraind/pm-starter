import type { ExtensionApi } from "@unbrained/pm-cli/sdk";
/**
 * Semantic exit codes this package throws via {@link CommandError}.
 *
 * Mirrored from the SDK contract rather than imported, because a
 * standalone-installed extension cannot resolve the SDK at runtime. pm's command
 * runtime only honors a thrown error's numeric `exitCode`, so mapping a failure
 * to one of these is what produces a clean, semantic non-zero exit instead of a
 * generic one.
 */
export declare const EXIT_CODE: {
    readonly GENERIC_FAILURE: 1;
    readonly USAGE: 2;
    readonly NOT_FOUND: 3;
};
/**
 * Error type that carries the numeric exit code pm's command runtime expects.
 *
 * pm's extension runtime re-invokes the handler and exits with a generic code
 * for a thrown {@link Error}; only an error exposing a numeric `exitCode` is
 * treated as a cleanly-handled, semantic non-zero exit (see {@link EXIT_CODE}).
 * Every intentional failure path in this package therefore throws a
 * {@link CommandError}.
 */
export declare class CommandError extends Error {
    /** Numeric exit code pm's runtime reads off the thrown error (see {@link EXIT_CODE}). */
    exitCode: number;
    constructor(message: string, exitCode?: number);
}
/**
 * Read a boolean option honoring both the kebab-case long flag and the
 * camelCase key the runtime may normalize it to (e.g. `--dry-run` -> `dryRun`).
 * Without this, `ctx.options["dry-run"]` can silently be `undefined`.
 */
export declare function optionEnabled(options: Record<string, unknown>, ...keys: string[]): boolean;
/** Read a string option, trying multiple key spellings; returns undefined if absent. */
export declare function optionString(options: Record<string, unknown>, ...keys: string[]): string | undefined;
/** Read a positive integer option from either the SDK's numeric or string form. */
export declare function optionPositiveInteger(options: Record<string, unknown>, fallback: number, ...keys: string[]): number;
/**
 * Safely read all items from the workspace by shelling out to `pm`. Returns an
 * empty array on any failure so demos never throw at activation/read time.
 * This is the SAFE read pattern every demo reuses.
 */
export declare function readPmItems(pmRoot: string): Array<Record<string, unknown>>;
declare const _default: {
    name: string;
    version: string;
    activate(api: ExtensionApi): void;
};
export default _default;
//# sourceMappingURL=index.d.ts.map
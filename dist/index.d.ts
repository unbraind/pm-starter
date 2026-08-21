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
export type PmReadOutcome = {
    readonly ok: true;
    readonly items: Array<Record<string, unknown>>;
} | {
    readonly ok: false;
    readonly reason: string;
};
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
export declare function readPmItems(pmRoot: string): PmReadOutcome;
/**
 * Name the reason a canonical `pm list --all` envelope is not the whole workspace, or
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
 * @param envelope - Parsed `pm list --all --json` output.
 * @returns A human-readable reason naming the tripped signal and the
 *          count-versus-total figures, or `null` if the answer is complete.
 */
export declare function describeListAllIncompleteness(envelope: unknown): string | null;
declare const _default: {
    name: string;
    version: string;
    activate(api: ExtensionApi): void;
};
export default _default;
//# sourceMappingURL=index.d.ts.map
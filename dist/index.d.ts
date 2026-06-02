export declare const EXIT_CODE: {
    readonly GENERIC_FAILURE: 1;
    readonly USAGE: 2;
    readonly NOT_FOUND: 3;
};
export declare class CommandError extends Error {
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
/**
 * Safely read all items from the workspace by shelling out to `pm`. Returns an
 * empty array on any failure so demos never throw at activation/read time.
 * This is the SAFE read pattern every demo reuses.
 */
export declare function readPmItems(pmRoot: string): Array<Record<string, any>>;
declare const _default: {
    name: string;
    version: string;
    activate(api: any): void;
};
export default _default;
//# sourceMappingURL=index.d.ts.map
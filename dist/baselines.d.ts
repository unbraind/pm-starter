import type { CommandHandlerContext, PmCompleteListResult } from "@unbrained/pm-cli/sdk";
/** Closed scenario set. Callers cannot name an arbitrary workflow. */
export type TaskCostScenario = "orientation" | "targeted-read" | "resume";
/** Directory client versus a structured-clone transport of the same reads. */
export type TaskCostRuntime = "directory" | "synthetic-remote";
/** Request modes. Declare pins an answer; run checks it; probe adds one full list. */
export type TaskCostMode = "declare" | "run" | "probe";
/** Report schema shared by the producer and the validator. */
export declare const TASK_COST_REPORT_SCHEMA = "pm-starter/task-cost-report/v1";
/** Declaration schema shared by import, export and the measurement producer. */
export declare const TASK_COST_DECLARATION_SCHEMA = "pm-starter/task-cost-baseline/v1";
/** Maximum repeats. Distributions stay bounded for agent output. */
export declare const TASK_COST_MAX_REPEATS = 8;
/** Maximum resume pages so a large corpus cannot loop without a checkpoint. */
export declare const TASK_COST_MAX_RESUME_PAGES = 8;
/** Resume page size. Two pages are enough to prove continuation on fleet trackers. */
export declare const TASK_COST_RESUME_LIMIT = 50;
/** Corpus observation refuses above this certified item count. */
export declare const TASK_COST_MAX_CORPUS_ITEMS = 5000;
/** Exact ratio. Decisions use this, never a binary float. */
export interface ExactRational {
    /** Numerator after reduction. */
    readonly n: number;
    /** Positive denominator after reduction. */
    readonly d: number;
}
/** Caller-pinned baseline. Corpus version and expected answer are required to run. */
export interface TaskCostDeclaration {
    readonly schema: typeof TASK_COST_DECLARATION_SCHEMA;
    readonly id: string;
    readonly scenario: TaskCostScenario;
    readonly corpus: {
        readonly id: string;
        readonly version: string;
    };
    readonly expected_answer: string;
    readonly repeats: number;
    readonly target_id?: string;
}
/** Distribution of one measured quantity. Median is an exact rational. */
export interface TaskCostDistribution {
    readonly min: number;
    readonly max: number;
    readonly median: ExactRational;
    readonly samples: readonly number[];
}
/** byte/4 figure. The label is part of the contract so agents do not treat it as a measurement. */
export interface TaskCostEstimate {
    readonly label: "estimate";
    readonly method: "bytes_div_4";
    readonly value: ExactRational;
    /** Decimal rendering for humans. Never an input to a pass/fail decision. */
    readonly display: string;
}
/** One scenario's measured cost and checked answer. */
export interface TaskCostScenarioReport {
    readonly scenario: TaskCostScenario;
    readonly corpus: {
        readonly id: string;
        readonly version: string;
    };
    readonly expected_answer: string;
    readonly answer: string;
    readonly answer_ok: true;
    readonly identical_answer: true;
    readonly tools: readonly string[];
    readonly synthetic_remote: {
        readonly calls: TaskCostDistribution;
        readonly delivered_bytes: TaskCostDistribution;
        readonly elapsed_ns: TaskCostDistribution;
    };
    readonly calls: TaskCostDistribution;
    readonly delivered_bytes: TaskCostDistribution;
    readonly elapsed_ns: TaskCostDistribution;
    readonly elapsed_use: "display_only";
    readonly estimate: TaskCostEstimate;
    readonly ceil_estimate: {
        readonly label: "estimate";
        readonly method: "ceil(utf8_bytes / 4)";
        readonly value: number;
    };
    readonly not_model_performance: true;
}
/** Proof that one extra certified full list increases both call and byte budgets. */
export interface TaskCostProbe {
    readonly injected: "listAllComplete";
    readonly worsened: true;
    readonly clean_calls: ExactRational;
    readonly wasted_calls: ExactRational;
    readonly clean_bytes: ExactRational;
    readonly wasted_bytes: ExactRational;
    readonly delta_calls: ExactRational;
    readonly delta_bytes: ExactRational;
}
/** Successful measurement. Every number has already passed the shared validator. */
export interface TaskCostSuccess {
    readonly ok: true;
    readonly schema: typeof TASK_COST_REPORT_SCHEMA;
    readonly mode: TaskCostMode;
    readonly not_model_performance: true;
    readonly process_calls: 0;
    readonly process_scope: "package_spawned_children";
    readonly runtime: {
        readonly engine: "node" | "bun";
        readonly version: string;
    };
    readonly declarations: readonly TaskCostDeclaration[];
    readonly corpus: {
        readonly id: string;
        readonly version: string;
        readonly observed_digest: string;
        readonly item_count: number;
    };
    readonly corpus_observation: {
        readonly calls: 2;
        readonly delivered_bytes: number;
        readonly excluded_from_scenario_budget: true;
    };
    readonly scenarios: readonly TaskCostScenarioReport[];
    readonly probe?: TaskCostProbe;
}
/** Typed refusal. Remediation is a fixed sentence, never a native exception. */
export interface TaskCostRefusal {
    readonly ok: false;
    readonly schema: typeof TASK_COST_REPORT_SCHEMA;
    readonly exit_code: 1 | 2;
    readonly code: "invalid_request" | "sdk_unavailable" | "source_unavailable" | "empty_tracker" | "answer_mismatch" | "corpus_mismatch" | "runtime_answer_mismatch" | "orientation_contract_unavailable" | "resume_contract_unavailable" | "item_not_found" | "status_registry_unavailable" | "budget_not_worsened" | "report_invalid";
    readonly remediation: string;
}
/** Result shared by the SDK and the CLI. */
export type TaskCostResult = TaskCostSuccess | TaskCostRefusal;
/** Host-injected reads. The package never resolves an SDK install path. */
export interface TaskCostClient {
    context(options: {
        for: "orient";
    }): Promise<unknown>;
    get(id: string, options?: {
        fields?: string;
        outputBudget?: "unbounded";
    }): Promise<unknown>;
    list(options: {
        status: "all";
        limit: string;
        fields: string;
        outputBudget: "unbounded";
        outputLimit: "unbounded";
        after?: string;
    }): Promise<unknown>;
    listAllComplete(): Promise<Pick<PmCompleteListResult, "items" | "complete_list">>;
    schemaList(): Promise<unknown>;
}
/** Injected host. Tests pass a real client; the CLI passes `ctx.sdk`. */
export interface TaskCostHost {
    readonly client: TaskCostClient;
    isItemNotFoundError?(error: unknown): boolean;
}
/** One configured status taken from the SDK schema list, including its role names. */
interface StatusDefinition {
    readonly id: string;
    readonly aliases: readonly string[];
    readonly roles: readonly string[];
}
/** Role membership copied from registry role names. Status ids are never compared to literals such as "done". */
interface StatusRoleIndex {
    readonly byToken: ReadonlyMap<string, string>;
    readonly active: ReadonlySet<string>;
    readonly blocked: ReadonlySet<string>;
    readonly done: ReadonlySet<string>;
    readonly canceled: ReadonlySet<string>;
    readonly terminal: ReadonlySet<string>;
    readonly openStatusId: string;
}
/** Describe the executing engine; accepts a version map for portable consumers and tests. */
export declare function taskCostRuntime(versions: Readonly<Record<string, string | undefined>>): TaskCostSuccess["runtime"];
/**
 * Contract failure inside a producer, mapped to a typed refusal by the runner.
 * The message is a stable remedy, not a native diagnostic.
 */
export declare class TaskCostContractError extends Error {
    /** Stable refusal code the runner copies onto the result. */
    readonly code: TaskCostRefusal["code"];
    /**
     * Create a producer-side contract failure.
     *
     * @param code - Refusal code the public result will carry.
     * @param remediation - Fixed remedy, without native error text.
     */
    constructor(code: TaskCostRefusal["code"], remediation: string);
}
/**
 * Build a reduced exact ratio. The denominator is always positive.
 *
 * @param numerator - Safe integer.
 * @param denominator - Non-zero safe integer.
 * @returns Reduced rational.
 */
export declare function exactRational(numerator: number, denominator?: number): ExactRational;
/**
 * Compare two rationals by cross-multiplication in bigint, so 1/2 and 2/4 match
 * and a binary float cannot round an inclusive boundary the wrong way.
 *
 * @param left - Exact ratio.
 * @param right - Exact ratio.
 * @returns -1, 0 or 1.
 */
export declare function rationalCompare(left: ExactRational, right: ExactRational): -1 | 0 | 1;
/**
 * Median of a non-empty bounded sample. Even counts use the exact mean of the
 * two central integers, stored as a ratio rather than a float.
 *
 * @param samples - Safe non-negative integers, length 1 to 8.
 * @returns Exact median.
 */
export declare function exactMedian(samples: readonly number[]): ExactRational;
/**
 * Render a non-negative rational for display only. Decisions must use {@link rationalCompare}.
 *
 * @param value - Reduced non-negative ratio.
 * @returns A decimal string with at most three fractional digits.
 */
export declare function formatRational(value: ExactRational): string;
/**
 * Label an exact byte count divided by 4 as an estimate.
 *
 * @param bytes - Delivered UTF-8 byte count, or an exact median of counts.
 * @returns Labeled estimate. The display string is not a decision input.
 */
export declare function bytesDiv4Estimate(bytes: number | ExactRational): TaskCostEstimate;
/**
 * Subtract two rationals with bigint cross-multiplication so a half-step median stays exact.
 *
 * @param left - Minuend.
 * @param right - Subtrahend.
 * @returns Reduced difference.
 */
export declare function subtractRationals(left: ExactRational, right: ExactRational): ExactRational;
/**
 * Integer ceiling of a non-negative rational. Used only to label the SDK's ceil(bytes/4) estimate.
 *
 * @param value - Non-negative exact ratio.
 * @returns Smallest integer greater than or equal to the ratio.
 */
export declare function ceilRational(value: ExactRational): number;
/**
 * Integer ceiling of bytes/4, matching the SDK estimator's documented formula.
 * It is still an estimate and is not consulted by budget decisions.
 *
 * @param bytes - Delivered UTF-8 byte count.
 * @returns Ceil(bytes/4) as a safe integer.
 */
export declare function ceilBytesDiv4(bytes: number): number;
/**
 * Decide whether a wasted run is strictly more expensive in both calls and bytes.
 * Comparison uses exact rationals, including when the median is a half-step.
 *
 * @param cleanCalls - Clean-run call median.
 * @param cleanBytes - Clean-run byte median.
 * @param wastedCalls - Wasted-run call median.
 * @param wastedBytes - Wasted-run byte median.
 * @returns True only when both quantities strictly increase.
 */
export declare function budgetWorsened(cleanCalls: ExactRational, cleanBytes: ExactRational, wastedCalls: ExactRational, wastedBytes: ExactRational): boolean;
/**
 * Build role sets from SDK-delivered role names. Status ids are stored only as
 * members of those sets; they are never tested with string equality against "open" or "done".
 *
 * @param definitions - Dense status definitions from `schemaList`.
 * @returns Lookup index and the registry's default-open status id.
 */
export declare function indexStatusRoles(definitions: readonly StatusDefinition[]): StatusRoleIndex;
/**
 * Resolve a status token to its registry id. Unknown tokens stay unresolved.
 *
 * @param status - Status text from an SDK row.
 * @param index - Role index built from the current registry.
 * @returns Registry id, or undefined when the registry has no such status.
 */
export declare function resolveStatusId(status: string, index: StatusRoleIndex): string | undefined;
/**
 * Parse `schemaList` statuses without accepting a hand-built role policy.
 *
 * @param value - SDK `schemaList` result.
 * @returns Dense definitions, or undefined when the payload is not the SDK shape.
 */
export declare function parseSchemaListStatuses(value: unknown): StatusDefinition[] | undefined;
/**
 * Canonical orientation answer: role counts plus a hash of id/role pairs.
 *
 * @param rows - Delivered focus rows.
 * @param index - Current status registry.
 * @returns Stable answer token.
 */
export declare function orientationAnswer(rows: readonly {
    id: string;
    status: string;
}[], index: StatusRoleIndex): string;
/**
 * Answer for one targeted get: the id and its registry role, not the status name.
 *
 * @param id - Requested item id.
 * @param status - Status text from the SDK get.
 * @param index - Current status registry.
 * @returns Stable answer token.
 */
export declare function targetedAnswer(id: string, status: string, index: StatusRoleIndex): string;
/**
 * Answer for a resumed page sequence. Duplicate ids are visible in the token.
 *
 * @param pages - Number of SDK pages read.
 * @param ids - Ids in delivery order, including duplicates if the cursor misbehaves.
 * @param index - Current status registry.
 * @param statuses - Status text parallel to `ids`.
 * @returns Stable answer token.
 */
export declare function resumeAnswer(pages: number, ids: readonly string[], statuses: readonly string[], index: StatusRoleIndex): string;
/**
 * Digest the certified corpus without putting item bodies into the answer.
 *
 * @param items - Certified complete-list rows.
 * @returns `digest:` plus a hex sha256 of id, status and updated_at.
 */
export declare function corpusDigest(items: readonly {
    id: string;
    status: string;
    updated_at: string;
}[]): string;
/**
 * Clone SDK results so the synthetic runtime cannot share object identity with the directory runtime.
 *
 * @param client - Directory client.
 * @returns Client whose methods return structured clones.
 */
export declare function syntheticRemoteClient(client: TaskCostClient): TaskCostClient;
/**
 * Validate a finished report with the same numeric domain the producer uses.
 * A bad scenario fails alone: the function reports the scenario name instead of discarding siblings.
 *
 * @param report - Producer output.
 * @returns The same report when every number is finite and in domain.
 */
export declare function assertTaskCostReport(report: TaskCostSuccess): TaskCostSuccess;
/**
 * Parse one untrusted declaration. Unknown keys, sparse data and non-finite numbers fail.
 *
 * @param input - Untrusted value.
 * @returns Canonical declaration, or undefined.
 */
export declare function parseTaskCostDeclaration(input: unknown): TaskCostDeclaration | undefined;
/**
 * Trim and turn CRLF into LF before a token is matched. This is the write-path normalizer.
 *
 * @param value - Untrusted string.
 * @param max - Maximum length after normalization.
 * @returns Normalized string, or undefined when the value is not a bounded string.
 */
export declare function canonicalToken(value: unknown, max: number): string | undefined;
/**
 * Parse a measurement request. Flat fields and a declaration array share this schema.
 *
 * @param input - Untrusted SDK or CLI payload.
 * @returns Canonical request pieces, or undefined.
 */
export declare function parseTaskCostRequest(input: unknown): {
    mode: TaskCostMode;
    scenario: TaskCostScenario | "all";
    repeats: number;
    corpusId: string;
    corpusVersion?: string;
    expectedAnswer?: string;
    targetId?: string;
    id?: string;
    declarations?: TaskCostDeclaration[];
} | undefined;
/**
 * Measure fixed scenarios and check answers on both supported runtimes.
 * Corpus observation is excluded from the scenario call and byte budgets.
 *
 * @param host - Injected SDK client.
 * @param input - Strict request object.
 * @returns Compact report or a typed refusal.
 */
export declare function runTaskCostBaselines(host: TaskCostHost, input: unknown): Promise<TaskCostResult>;
/**
 * Map CLI options onto the strict request. Host renderer flags are ignored, not rejected.
 *
 * @param options - Command options from the host.
 * @returns Strict request object.
 */
export declare function taskCostRequestFromOptions(options: Record<string, unknown>): Record<string, unknown>;
/**
 * Run the baseline command from the host-injected SDK only.
 *
 * @param ctx - Extension command context. `ctx.sdk` is required.
 * @returns The same result the SDK function returns.
 */
export declare function runTaskCostCommand(ctx: Pick<CommandHandlerContext, "options" | "sdk">): Promise<TaskCostResult>;
export {};
//# sourceMappingURL=baselines.d.ts.map
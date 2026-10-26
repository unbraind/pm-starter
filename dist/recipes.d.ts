/** Failure-first read recipes: native SDK refusals, structured remedies, then verified recovery. */
import type { CommandHandlerContext, PmClient, PmCompleteListResult } from "@unbrained/pm-cli/sdk";
/** Small closed request domain; no executable commands or arbitrary retry options are accepted. */
export type FailureFirstRecipe = "missing-item" | "unsupported-capability" | "insufficient-budget";
/** The only untrusted input accepted by the SDK entrypoint. */
export interface FailureFirstRequest {
    readonly recipe?: FailureFirstRecipe | "all";
}
/** Host-owned native reads and missing-item classification, with no runtime SDK resolution. */
export interface FailureFirstHost {
    readonly client: Pick<PmClient, "get" | "list" | "listAllComplete" | "graph" | "run">;
    isItemNotFoundError(error: unknown): boolean;
}
/** Bounded recovery evidence; no item bodies, native prose, source paths or arbitrary argv. */
export interface FailureFirstReceipt {
    readonly recipe: FailureFirstRecipe;
    readonly code: "item_not_found" | "unknown_subcommand" | "requested_budget_infeasible";
    /** Missing-item codes use the public host classifier; the other discriminators are emitted directly. */
    readonly code_source: "sdk_classifier" | "native_payload";
    readonly remedy: "discover_existing_id" | "choose_allowed_read" | "use_advertised_budget";
    readonly retry: "client.get(discoveredId)" | "client.graph('ancestors', { id })" | "client.listAllComplete()";
    readonly recovered: true;
}
/** Successful receipts have constant row cardinality and SDK-certified source counts. */
export interface FailureFirstSuccess {
    readonly ok: true;
    readonly schema: "pm-starter/failure-first/v1";
    readonly item_count: number;
    readonly recipes: readonly FailureFirstReceipt[];
}
/** Package failures never expose human native errors or claim a successful recovery. */
export interface FailureFirstRefusal {
    readonly ok: false;
    readonly exit_code: 1 | 2;
    readonly code: "invalid_request" | "sdk_unavailable" | "empty_tracker" | "source_unavailable" | "recovery_contract_unavailable";
    readonly remediation: string;
}
/** Typed result shared by CLI and SDK. */
export type FailureFirstResult = FailureFirstSuccess | FailureFirstRefusal;
/** One strict boundary schema: a plain object with only an optional, bounded enum selector. */
export declare function parseFailureFirstRequest(input: unknown): FailureFirstRequest | undefined;
/** An absent native recovery contract is distinct from an unreadable source. */
export declare class FailureFirstContractError extends Error {
    constructor();
}
/** Validate every emitted number before constructing a successful receipt. */
export declare function failureFirstItemCount(source: Pick<PmCompleteListResult, "complete_list" | "items">): number;
/** Require the native classifier plus opaque structured guidance, without parsing its prose. */
export declare function assertMissingItemRecovery(error: unknown, classified: boolean): void;
/** Choose the safe read only when the native refusal advertises it in its complete legal domain. */
export declare function assertUnsupportedCapabilityRecovery(error: unknown): void;
/** Admit only the native budget remedy that the canonical complete-list API implements. */
export declare function assertInsufficientBudgetRecovery(value: unknown): void;
/** Observe a native read failure without translating its producer-owned payload or inspecting prose. */
export declare function captureReadRefusal(read: () => Promise<unknown>): Promise<unknown>;
/**
 * Complete bounded native recovery loops against the supplied tracker, without durable writes.
 * Each retry is an allowlisted SDK read; advertised shell strings are never executed.
 * Counts describe the initial certified read, not an atomic snapshot across separate reads.
 */
export declare function runFailureFirstRecipes(host: FailureFirstHost, input?: unknown): Promise<FailureFirstResult>;
/** Run the same public recipe API with the host-bound SDK and one CLI selector. */
export declare function runFailureFirstCommand(ctx: Pick<CommandHandlerContext, "options" | "sdk">): Promise<FailureFirstResult>;
//# sourceMappingURL=recipes.d.ts.map
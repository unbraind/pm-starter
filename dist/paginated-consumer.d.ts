import type { CommandHandlerContext, PmClient } from "@unbrained/pm-cli/sdk";
/** These are host continuations, never package-encoded cursors. */
export interface ConsumerCheckpoint {
    readonly version: 1;
    readonly source: string;
    readonly mode: "producer" | "output";
    readonly page_size: number;
    readonly page_tokens: number;
    readonly token_budget: number;
    readonly spent_tokens: number;
    readonly admitted: number;
    readonly pages: number;
    readonly last_id: string | null;
    readonly after: string | null;
    readonly output_cursor: string | null;
    readonly done: boolean;
}
/** The single input schema accepts a fresh task or a checkpoint emitted by this recipe. */
export interface ConsumerRequest {
    readonly mode?: "producer" | "output";
    readonly pageSize?: number;
    readonly pageTokens?: number;
    readonly tokenBudget?: number;
    readonly maxPages?: number;
    readonly checkpoint?: ConsumerCheckpoint;
}
/** Only reads are available; sourceKey identifies the caller's tracker connection, without disclosing it. */
export interface ConsumerHost {
    readonly client: Pick<PmClient, "list">;
    readonly sourceKey: string;
}
/** Trusted process controls are separate from serializable, untrusted task input. */
export interface ConsumerControls {
    readonly signal?: AbortSignal;
    /** Synchronous observation after atomic page admission; copies cannot mutate the running task. */
    readonly onPage?: (ids: readonly string[], checkpoint: Readonly<ConsumerCheckpoint>) => void;
}
/** Constant-size receipt: full rows belong to the observer, not the agent's response context. */
export type ConsumerResult = {
    readonly ok: true;
    readonly schema: "pm-starter/paginated-consumer/v1";
    readonly stop: "complete" | "canceled" | "page_limit" | "task_budget";
    readonly admitted_this_call: number;
    readonly checkpoint: ConsumerCheckpoint;
} | {
    readonly ok: false;
    readonly exit_code: 1 | 2;
    readonly code: "invalid_request" | "sdk_unavailable" | "wrong_source" | "cursor_rejected" | "budget_insufficient" | "host_refused" | "source_unavailable" | "contract_unavailable" | "observer_failed";
    readonly remedy: string;
    readonly native_code?: string;
    readonly checkpoint?: ConsumerCheckpoint;
};
/** One strict schema is shared by SDK inputs, CLI inputs and emitted checkpoint validation. */
export declare function parseConsumerRequest(input: unknown): ConsumerRequest | undefined;
/**
 * Admit complete pages into a count/last-identity accumulator. The host owns ordering,
 * cursors, compaction and token accounting. Cancellation never admits a partial page.
 * Only IDs are requested, so no prior full facts need retaining for session suppression.
 * No checkpoint file, lease, source write, external delivery or transaction is hidden here.
 */
export declare function consumePaginated(host: ConsumerHost, input?: unknown, controls?: ConsumerControls): Promise<ConsumerResult>;
/** Normalize CLI transport spellings only; all domain validation belongs to parseConsumerRequest. */
export declare function runConsumerCommand(ctx: Pick<CommandHandlerContext, "options" | "sdk" | "pm_root">): Promise<ConsumerResult>;
//# sourceMappingURL=paginated-consumer.d.ts.map
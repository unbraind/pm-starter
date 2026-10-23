import type { CommandHandlerContext, PmClient, PmCompleteListResult } from "@unbrained/pm-cli/sdk";
/** One extension capability per exercise; this is not a project generator. */
export type LaboratoryCapability = "commands" | "importers";
/** Both exercises declare reads and deliberately refuse mutation. */
export type LaboratoryOperation = "read" | "mutate";
/** Minimal host-owned SDK surface; no runtime package-resolution dependency. */
export type LaboratoryClient = Pick<PmClient, "listAllComplete">;
/** Same input contract for directory reads and synthetic remote replay. */
export interface LaboratoryAdapter {
    /** Explicit allowlist checked before calling the backend. */
    readonly capabilities: readonly LaboratoryOperation[];
    /** Return the canonical SDK-certified whole-corpus result. */
    read(): Promise<PmCompleteListResult>;
}
/** Compact successful receipt, identical across transports and free of item contents. */
export interface LaboratorySuccess {
    /** Stable discriminator and schema version. */
    readonly ok: true;
    readonly schema: "pm-starter/laboratory/v1";
    readonly capability: LaboratoryCapability;
    readonly operation: "read";
    readonly item_count: number;
    /** Sorted status counts for commands, or exported bytes and digest for importers. */
    readonly evidence: Record<string, number | string>;
}
/** Actionable refusals are values in the SDK and nonzero results in the CLI. */
export interface LaboratoryRefusal {
    readonly ok: false;
    readonly schema: "pm-starter/laboratory/v1";
    readonly capability: LaboratoryCapability;
    readonly operation: LaboratoryOperation;
    readonly code: "unsupported_capability" | "source_unavailable";
    readonly remedy: string;
}
/** Versioned result shared by both adapters. */
export type LaboratoryReceipt = LaboratorySuccess | LaboratoryRefusal;
/** Paired receipts include an explicit unsupported-mutation probe for each adapter. */
export interface LaboratoryRun {
    readonly directory: LaboratoryReceipt;
    readonly synthetic_remote: LaboratoryReceipt;
    readonly directory_refusal: LaboratoryReceipt;
    readonly synthetic_remote_refusal: LaboratoryReceipt;
    readonly identical: boolean;
}
/** Bind an initialized directory tracker through the public, host-owned SDK client. */
export declare function createDirectoryLaboratoryAdapter(client: LaboratoryClient): LaboratoryAdapter;
/** Replay a certified SDK read over a synthetic asynchronous transport, without a network service. */
export declare function createSyntheticRemoteLaboratoryAdapter(client: LaboratoryClient): LaboratoryAdapter;
/**
 * Exercise one capability; preflight never delegates unsupported operations to the backend.
 * The adapter contract accepts SDK-certified reads, not arbitrary remote envelopes.
 */
export declare function executeCapabilityLaboratory(adapter: LaboratoryAdapter, capability: LaboratoryCapability, operation?: LaboratoryOperation): Promise<LaboratoryReceipt>;
/** Run the same exercise and refusal probe against both backends, retaining parity evidence. */
export declare function runCapabilityLaboratory(client: LaboratoryClient, capability: LaboratoryCapability, operation?: LaboratoryOperation): Promise<LaboratoryRun>;
/** Structured host result preserves typed refusal data and a nonzero CLI status. */
export interface LaboratoryCommandRefusal {
    readonly ok: false;
    readonly exit_code: 1 | 2;
    readonly code: "invalid_request" | "sdk_unavailable" | "laboratory_refused";
    readonly remediation: string;
    readonly receipt?: LaboratoryRun;
}
/** Invoke the paired laboratory through the injected SDK without resolving a runtime package. */
export declare function runLaboratoryCommand(ctx: Pick<CommandHandlerContext, "options" | "sdk">): Promise<LaboratoryRun | LaboratoryCommandRefusal>;
/** Register this as an exporter to exercise the importers capability with the same backend receipts. */
export declare function runExportLaboratory(ctx: Pick<CommandHandlerContext, "options" | "sdk">): Promise<LaboratoryRun | LaboratoryCommandRefusal>;
//# sourceMappingURL=laboratories.d.ts.map
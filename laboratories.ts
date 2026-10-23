/** Portable, read-only exercises using host-certified SDK reads and a synthetic transport. */
import { createHash } from "node:crypto";
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
export function createDirectoryLaboratoryAdapter(client: LaboratoryClient): LaboratoryAdapter {
  return { capabilities: ["read"], read: () => client.listAllComplete() };
}

/** Replay a certified SDK read over a synthetic asynchronous transport, without a network service. */
export function createSyntheticRemoteLaboratoryAdapter(client: LaboratoryClient): LaboratoryAdapter {
  return { capabilities: ["read"], async read() { return structuredClone(await client.listAllComplete()); } };
}

/**
 * Exercise one capability; preflight never delegates unsupported operations to the backend.
 * The adapter contract accepts SDK-certified reads, not arbitrary remote envelopes.
 */
export async function executeCapabilityLaboratory(
  adapter: LaboratoryAdapter,
  capability: LaboratoryCapability,
  operation: LaboratoryOperation = "read",
): Promise<LaboratoryReceipt> {
  // These laboratories have no mutation implementation, even if a caller widens the adapter allowlist.
  if (operation !== "read" || !adapter.capabilities.includes(operation)) {
    return { ok: false, schema: "pm-starter/laboratory/v1", capability, operation,
      code: "unsupported_capability", remedy: "Use read; implement and verify a separate write capability before enabling mutation." };
  }
  try {
    const result = await adapter.read();
    let evidence: Record<string, number | string>;
    if (capability === "commands") {
      const counts = new Map<string, number>();
      for (const item of result.items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      evidence = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
    } else {
      // A small exporter: deterministic minimal JSON, with only size/digest in the agent receipt.
      const rows = result.items.map(({ id, type, status }) => ({ id, type, status }));
      rows.sort((a, b) => a.id.localeCompare(b.id));
      const exported = JSON.stringify(rows);
      evidence = { exported_bytes: Buffer.byteLength(exported), sha256: createHash("sha256").update(exported).digest("hex") };
    }
    return { ok: true, schema: "pm-starter/laboratory/v1", capability, operation,
      item_count: result.complete_list.item_count, evidence };
  } catch {
    return { ok: false, schema: "pm-starter/laboratory/v1", capability, operation,
      code: "source_unavailable", remedy: "Initialize a readable tracker with pm init; supply a client whose listAllComplete read passes SDK certification, then retry read." };
  }
}

/** Run the same exercise and refusal probe against both backends, retaining parity evidence. */
export async function runCapabilityLaboratory(
  client: LaboratoryClient,
  capability: LaboratoryCapability,
  operation: LaboratoryOperation = "read",
): Promise<LaboratoryRun> {
  const directory = createDirectoryLaboratoryAdapter(client);
  const remote = createSyntheticRemoteLaboratoryAdapter(client);
  const directoryRefusal = await executeCapabilityLaboratory(directory, capability, "mutate");
  const remoteRefusal = await executeCapabilityLaboratory(remote, capability, "mutate");
  const directoryReceipt = await executeCapabilityLaboratory(directory, capability, operation);
  const remoteReceipt = await executeCapabilityLaboratory(remote, capability, operation);
  return { directory: directoryReceipt, synthetic_remote: remoteReceipt,
    directory_refusal: directoryRefusal, synthetic_remote_refusal: remoteRefusal,
    identical: JSON.stringify(directoryReceipt) === JSON.stringify(remoteReceipt) };
}

/** Structured host result preserves typed refusal data and a nonzero CLI status. */
export interface LaboratoryCommandRefusal {
  readonly ok: false;
  readonly exit_code: 1 | 2;
  readonly code: "invalid_request" | "sdk_unavailable" | "laboratory_refused";
  readonly remediation: string;
  readonly receipt?: LaboratoryRun;
}

/** Invoke the paired laboratory through the injected SDK without resolving a runtime package. */
export async function runLaboratoryCommand(
  ctx: Pick<CommandHandlerContext, "options" | "sdk">,
): Promise<LaboratoryRun | LaboratoryCommandRefusal> {
  const capability = ctx.options.capability ?? "commands";
  const operation = ctx.options.operation ?? "read";
  if ((capability !== "commands" && capability !== "importers") || (operation !== "read" && operation !== "mutate")) {
    return { ok: false, exit_code: 2, code: "invalid_request",
      remediation: "Use --capability commands|importers and --operation read|mutate." };
  }
  if (!ctx.sdk) {
    return { ok: false, exit_code: 2, code: "sdk_unavailable",
      remediation: "Use a pm host that injects ctx.sdk (pm-cli >=2026.10.20)." };
  }
  const receipt = await runCapabilityLaboratory(ctx.sdk.client, capability, operation);
  if (!receipt.identical || !receipt.directory.ok || !receipt.synthetic_remote.ok) {
    return { ok: false, exit_code: 1, code: "laboratory_refused", receipt,
      remediation: "Inspect the receipt; use a stable, readable certified source with --operation read." };
  }
  return receipt;
}

/** Register this as an exporter to exercise the importers capability with the same backend receipts. */
export function runExportLaboratory(ctx: Pick<CommandHandlerContext, "options" | "sdk">): Promise<LaboratoryRun | LaboratoryCommandRefusal> {
  return runLaboratoryCommand({ ...ctx, options: { ...ctx.options, capability: "importers" } });
}

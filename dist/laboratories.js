/** Portable, read-only exercises using host-certified SDK reads and a synthetic transport. */
import { createHash } from "node:crypto";
/** Bind an initialized directory tracker through the public, host-owned SDK client. */
export function createDirectoryLaboratoryAdapter(client) {
    return { capabilities: ["read"], read: () => client.listAllComplete() };
}
/** Replay a certified SDK read over a synthetic asynchronous transport, without a network service. */
export function createSyntheticRemoteLaboratoryAdapter(client) {
    return { capabilities: ["read"], async read() { return structuredClone(await client.listAllComplete()); } };
}
/**
 * Exercise one capability; preflight never delegates unsupported operations to the backend.
 * The adapter contract accepts SDK-certified reads, not arbitrary remote envelopes.
 */
export async function executeCapabilityLaboratory(adapter, capability, operation = "read") {
    // These laboratories have no mutation implementation, even if a caller widens the adapter allowlist.
    if (operation !== "read" || !adapter.capabilities.includes(operation)) {
        return { ok: false, schema: "pm-starter/laboratory/v1", capability, operation,
            code: "unsupported_capability", remedy: "Use read; implement and verify a separate write capability before enabling mutation." };
    }
    try {
        const result = await adapter.read();
        let evidence;
        if (capability === "commands") {
            const counts = new Map();
            for (const item of result.items)
                counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
            evidence = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
        }
        else {
            // A small exporter: deterministic minimal JSON, with only size/digest in the agent receipt.
            const rows = result.items.map(({ id, type, status }) => ({ id, type, status }));
            rows.sort((a, b) => a.id.localeCompare(b.id));
            const exported = JSON.stringify(rows);
            evidence = { exported_bytes: Buffer.byteLength(exported), sha256: createHash("sha256").update(exported).digest("hex") };
        }
        return { ok: true, schema: "pm-starter/laboratory/v1", capability, operation,
            item_count: result.complete_list.item_count, evidence };
    }
    catch {
        return { ok: false, schema: "pm-starter/laboratory/v1", capability, operation,
            code: "source_unavailable", remedy: "Initialize a readable tracker with pm init; supply a client whose listAllComplete read passes SDK certification, then retry read." };
    }
}
/** Run the same exercise and refusal probe against both backends, retaining parity evidence. */
export async function runCapabilityLaboratory(client, capability, operation = "read") {
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
/** Invoke the paired laboratory through the injected SDK without resolving a runtime package. */
export async function runLaboratoryCommand(ctx) {
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
export function runExportLaboratory(ctx) {
    return runLaboratoryCommand({ ...ctx, options: { ...ctx.options, capability: "importers" } });
}
//# sourceMappingURL=laboratories.js.map
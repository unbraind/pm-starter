# Portable capability laboratories

These exercises demonstrate one extension capability at a time. They use a host-owned
`PmClient.listAllComplete()` read, whose SDK certificate proves the complete tracker
(including terminal items). They do not parse tracker files, paginate manually, spawn
Git, generate a project, or implement a remote storage protocol.

The commands exercise (`starter lab --capability commands`) groups certified item
statuses. The importers exercise (`starter-lab export`, also available through
`starter lab --capability importers`) exports sorted `id`, `type`, and `status` rows
internally and returns only their UTF-8 byte count and SHA-256 digest. Neither receipt
contains titles, bodies, IDs, credentials, or tracker paths. Status counts are data,
so receipt size grows with the number of distinct workspace statuses, not item count.

Both exercises first probe a declared unsupported `mutate` operation on each adapter,
then run the requested read. The directory adapter delegates to the supplied SDK
client. The synthetic remote adapter replays a second certified read asynchronously
through structured cloning. This tests value transport and backend neutrality without
a hosted service. It is not a test of authentication, HTTP, MCP, Postgres, remote
concurrency, or certification of an arbitrary remote response. A real remote adapter
must certify untrusted envelopes with the SDK before satisfying `LaboratoryAdapter`.

Receipts omit transport names internally, so the paired `directory` and
`synthetic_remote` receipts must be byte-for-byte identical. `identical: false` means
the source changed or the adapters differ; the CLI refuses rather than asserting
conformance. The two reads are not an atomic cross-backend snapshot.

## Executable examples

Initialize a plain directory tracker and install the built extension before running:

```sh
pm init --defaults --agent-guidance skip
pm install /path/to/pm-starter --project
pm starter lab --capability commands --json
pm starter lab --capability importers --json
pm starter-lab export --json
pm starter lab                         # native compact TOON
pm starter lab --operation mutate --json  # intentional exit 1, typed refusal
```

Installation is setup and can write extension metadata. Laboratory invocations disable
the starter's extension migrations, and neither the exercises nor their refusal probes
write item documents, schema, settings, or history. SDK cache/lock files remain
host-owned runtime state. The CLI requires an injected SDK (tested with the pinned
2026.10.20 host); older hosts get `sdk_unavailable` and an upgrade remedy.

The SDK example runs from an installed consumer project, without requiring Git:

```ts
import { PmClient } from "@unbrained/pm-cli/sdk";
import { runCapabilityLaboratory } from "pm-starter";

const client = new PmClient({ pmRoot: ".agents/pm", noExtensions: true });
for (const capability of ["commands", "importers"] as const) {
  const receipt = await runCapabilityLaboratory(client, capability);
  console.log(JSON.stringify(receipt));
  if (!receipt.identical || !receipt.directory.ok) process.exitCode = 1;
}
```

To reuse one exercise, register `runLaboratoryCommand` with `registerCommand` or
`runExportLaboratory` with `registerExporter`. Their only host dependency is
`ctx.sdk.client`; all pm imports in shipped code remain type-only. A caller can also
compose `createDirectoryLaboratoryAdapter`, `createSyntheticRemoteLaboratoryAdapter`,
and `executeCapabilityLaboratory` directly. Pass only SDK-certified sources to the
adapter interface; the package never casts an untrusted wire payload to that type.

SDK refusals are discriminated values: `unsupported_capability` tells callers to use
`read` and implement a separate verified write capability; `source_unavailable` asks
for an initialized, readable tracker and a certified SDK source. Raw provider errors
are redacted. CLI failures preserve the paired receipt and set `exit_code: 1`;
`invalid_request` and `sdk_unavailable` set `exit_code: 2`. Failed reads remain failures,
including corrupt or partial tracker scans; they never become zero-item success.

Core `extension init` owns scaffolding, the original starter still demonstrates all
nine registration types, and pm-ts-starter owns the generated production TypeScript
backend conformance project. These laboratories add reusable exercises rather than
another scaffold or production template.

## Validation receipt

Public source: `unbraind/pm-starter`, main commit
`fd1c630a80c904a8c12d963c1a93842c831e926b`. Setup installed the built extension in
a copied tracker, then froze 156 durable files read-only. Reads ran in a non-Git
temporary directory with `GIT_CEILING_DIRECTORIES` set and a PATH containing only
Node. Durable fingerprints before and after all SDK/CLI reads and refusals matched.
No original tracker was mutated.

| Measurement | Commands | Importers |
|---|---:|---:|
| Certified items | 75 | 75 |
| Terminal items included | 70 | 70 |
| CLI JSON bytes | 1,132 | 1,200 |
| CLI TOON bytes | 910 | 998 |
| Mutation refusal exit status | 1 | 1 |
| SDK / CLI / adapter receipt equality | pass | pass |

Status counts were 4 open, 1 in progress, 69 closed, and 1 canceled. The minimal
export measured 4,335 UTF-8 bytes with SHA-256
`79226b8161a4475c9a5ad1a93d2d7257ba4c88e9747f5137d6a30a592031100a`.
This is a copied public corpus measurement, not hosted remote acceptance.

Targeted tests exercise both registered command paths, Git-free operation, missing
SDK and invalid-input refusals, unreadable sources, concurrent-source parity failure,
preflight refusal before provider calls, and unchanged durable tracker content.
Reverting the unsupported-operation guard alone fails the refusal regression;
reverting laboratory migration suppression alone fails the read-only preflight
regression. Restoring both passes. The new module measured 100% lines, branches,
and functions in the targeted run. The full unchanged-threshold npm and Bun
release gates run in CI on Node 22 and 26.

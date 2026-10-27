# Agent task cost baselines

`pm starter baseline` is a reproducible consumer example for extension authors.
It checks fixed answers while measuring SDK tool calls, UTF-8 JSON delivery bytes,
and the summed wall time spent awaiting those calls. It reports samples, minimum,
maximum, and an exact rational median. Time is display-only. `bytes_div_4` and
`ceil(utf8_bytes / 4)` are **estimates**, not measured tokens or model performance.

This differs from pm-observer's external capture accounting, pm-rust's native
operation benchmarks, and pm-cli's internal release protocol ratchet. No model is
called. No network backend or real remote latency is certified by the synthetic
transport check.

## Fixed scenarios

| Scenario | SDK protocol | Checked answer |
| --- | --- | --- |
| `orientation` | `schemaList`, `context({for: "orient"})` | Focus IDs and roles, hashed, plus role counts |
| `targeted-read` | `schemaList`, projected `get(id)` | Exact target ID and configured status role |
| `resume` | `schemaList`, projected `list` pages using producer `next_cursor` | Page/row/duplicate counts and a hash of all IDs and roles |

Each repetition runs both the injected directory client and a structured-clone
transport of its real responses, checking the same answer. Both distributions are
reported. The top-level runtime identifies the executing Node or Bun version;
comparison across engines requires executing the same declarations under each.
`process_calls: 0` counts child processes launched by this package, not hidden
backend implementation work or the shell invocation used to launch pm.

Two certified `listAllComplete` corpus observations, before and after measurement,
are reported separately and excluded from each scenario budget. A changed corpus refuses the run. The budgets describe one scenario execution;
they do not represent the entire command's work (which also executes setup,
repetitions, transport verification, and, in probe mode, wasted runs).

## Declare, replay, probe

On a fixed tracker copy, first pin a corpus and its expected answers:

```bash
pm starter baseline --mode declare --scenario all --corpus-id public-example --repeats 3 --json > declared.json
```

The emitted `declarations` array is the portable baseline. Every row includes its
schema, identity, corpus ID/version, expected answer, repeat count, and targeted
item when applicable. The default version is a digest of sorted SDK ID, status,
and update-time tuples. An explicit version is a caller assertion; `digest:`
versions are verified against the observed corpus before scenario execution.
A timestamp-changing native edit invalidates a digest declaration.

Replay one scenario directly, or pass the emitted array for all three:

```bash
pm starter baseline --mode run --corpus-id public-example --declarations "$(node -e 'const fs=require("node:fs");console.log(JSON.stringify(JSON.parse(fs.readFileSync("declared.json","utf8")).declarations))')" --json
pm starter baseline --mode probe --corpus-id public-example --declarations "$(node -e 'const fs=require("node:fs");console.log(JSON.stringify(JSON.parse(fs.readFileSync("declared.json","utf8")).declarations))')" --json
```

Probe adds one certified full-list call after the **first** selected scenario.
Both transports must keep the identical answer; call and byte medians must both
strictly increase. The receipt includes clean/wasted medians and exact deltas.
Default output is TOON; `--json` uses the host's JSON renderer. Reports contain
hashed answers and aggregate measurements, without item titles or bodies.
Keep any exported declarations appropriate to the audience: targeted IDs remain
visible.

The typed SDK entry point uses host injection, lazily when invoked:

```ts
import { runTaskCostBaselines } from "pm-starter";
// sdk is ctx.sdk supplied by the pm host; no install-path discovery.
const report = await runTaskCostBaselines({ client: sdk.client }, {
  mode: "declare", scenario: "all", corpus_id: "example", repeats: 3,
});
if (report.ok) {
  const replay = await runTaskCostBaselines({ client: sdk.client }, {
    mode: "probe", corpus_id: "example", declarations: report.declarations,
  });
}
```

## Bounds and refusals

One strict input contract rejects unknown fields, sparse declaration arrays,
non-finite numbers, and malformed or oversized tokens. Token whitespace and CRLF
are canonicalized by the declaration producer/parser. Repeats are integers 1–8,
declaration batches contain 1–3 rows, corpus IDs and item IDs are at most 64
characters, versions at most 128, and expected answers at most 512. Corpus
observation caps at 5,000 items; resume caps at eight 50-row pages and refuses
incomplete traversal. Every emitted numeric value is a non-negative safe integer;
ratio denominators are positive. Exact integer cross-products decide budgets.

A refusal returns `ok: false`, a stable code, `exit_code`, and `remediation`.
Usage and SDK-injection failures exit 2; missing/changed data, unsupported native
read contracts, answer mismatches, or invalid measurements exit 1. Re-declare an
intentionally changed corpus; use the specified target or a compatible host for
missing read contracts. Native paths and exception text are not exposed.

The package requires a host with injected SDK support and context orient intent
(pm-cli 2026.10.23 or later). Ordinary starter commands retain their existing
compatibility floor.

## Without git and read-only validation

All baseline modes work on a plain tracker with no Git executable. They call no
SDK mutation, claim, sync, journal, or compensation API. Portable declarations are
JSON values; this feature does not import them into tracker items. SDK-derived
caches may be attempted on a writable tracker. For reproducible public validation,
extract only the public repository's tracked tracker into a disposable directory,
make that copy read-only, and run:

```bash
node scripts/validate-task-cost-baselines.ts PUBLIC_TRACKER_COPY
bun scripts/validate-task-cost-baselines.ts PUBLIC_TRACKER_COPY
```

The script checks read-only permissions before SDK access and verifies the full
copy's file hashes afterward. It declares all scenarios, repeats each three times,
replays and probes the same answers, and prints measured receipts. Use a non-git
directory and set `GIT_CEILING_DIRECTORIES` to its parent. Source trackers are
never changed by this validation procedure.

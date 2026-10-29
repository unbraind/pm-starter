# Cancellation-safe paginated consumption

`pm starter consume` is a real read-only extension recipe. It calls the injected
`ctx.sdk.client.list`, consumes native producer/output continuations and charges
the host's output-session receipt against one cumulative task token budget.
It accumulates the number and last identity admitted; it does not export item
bodies or deliver events to another system.

```sh
pm starter consume --page-size 2 --max-pages 2 --json > receipt.json
pm starter consume --checkpoint "$(node -p 'JSON.stringify(require("./receipt.json").checkpoint)')" --json
```

The first invocation admits two pages and returns `stop: page_limit`. SIGINT or
SIGTERM instead returns `stop: canceled` and removes its process listeners.
The SDK example below cancels deterministically after page two. Resume preserves
the source binding, query, native cursor, cumulative count and charged tokens.
A completed checkpoint performs no more reads. Receipts use the host JSON/TOON
renderer and contain bounded counts, an opaque source digest and a checkpoint,
never full source records or connection paths.

```ts
import { consumePaginated } from "pm-starter";
import type { ConsumerHost, ConsumerCheckpoint } from "pm-starter";

// In an extension command, use the injected SDK. No argv/symlink resolution.
const host: ConsumerHost = { client: ctx.sdk.client, sourceKey: ctx.pm_root };
const controller = new AbortController();
const first = await consumePaginated(host, { pageSize: 2, maxPages: 16 }, {
  signal: controller.signal,
  onPage(ids, checkpoint) {
    // ids and checkpoint are frozen copies, observed AFTER page admission.
    console.log(ids.length, checkpoint.admitted);
    if (checkpoint.pages === 2) controller.abort();
  },
});
if (first.ok) {
  const checkpoint: ConsumerCheckpoint = first.checkpoint;
  const resumed = await consumePaginated(host, { checkpoint, maxPages: 16 });
  console.log(resumed);
}
```

`onPage` is a synchronous observer of this recipe's accumulator. An exception
returns `observer_failed` with the **already admitted** checkpoint. It is not an
external sink transaction. To deliver externally, integrate a journaled sink
that atomically commits delivery and checkpoint under its own lease or CAS;
do not copy this observer as an exactly-once delivery implementation. Two calls
given the same checkpoint independently replay that read. The package owns no
shared checkpoint file, claim, lease, outbox or background worker. Callers that
share persistence must serialize their own checkpoint writes, re-read expected
revisions under that lease and refuse stale generations. The recipe does not
use `commitWorkspaceTransaction` or claim isolation from ordinary SDK writers.

Admission is atomic per page. Cancellation before a read consumes no budget.
Cancellation during a native read waits for it, charges its host receipt, admits
none of that page, and retains the preceding cursor. Cancellation after admission
retains the whole page's cursor. This avoids both partially admitted pages and
replaying the last admitted row. Abrupt process death cannot return a checkpoint;
durable recovery belongs to the caller's journal. Signal handling is cooperative,
not a deadline or an interruptible native read.

| Input | Domain and default |
| --- | --- |
| `mode` | `producer` (default) or `output`; immutable on resume |
| `pageSize` / `--page-size` | 1–128 integer, default 16; immutable on resume |
| `pageTokens` / `--page-tokens` | 256–8192 integer, default 2048; immutable on resume |
| `tokenBudget` / `--token-budget` | 256–10000000 integer, default 16000; may increase on resume |
| `maxPages` / `--max-pages` | 1–16 integer per invocation, default 4 |
| `checkpoint` / `--checkpoint` | Emitted v1 object; CLI accepts JSON up to 16384 characters |

One strict schema validates inputs and every emitted checkpoint. Numeric decisions
use bounded safe integers; there are no floating point ratios. IDs are the only
source field requested, so the native session carries spent tokens without
retaining prior full facts in `seen_item_ids`. It is still the host that computes
the complete-envelope token estimate (`ceil(utf8_bytes / 4)`), including its
receipts. Final recipe receipt bytes and internal tracker scan work are outside
that host read-token budget. Native output compaction may return fewer rows than
the producer page size. Every host cursor is forwarded verbatim: `after` for
producer continuation, `outputCursor` for output continuation while preserving
the producer's original `after` position. No cursor is decoded, manufactured or
replaced with an offset.

Producer mode follows native item identities in `created_at` order. It requires
a stable source for complete, duplicate-free enumeration. The source digest binds
the tracker connection, **not a frozen tracker revision**. The package does not
make a mutable native producer cursor into a snapshot. Output mode requests the
host's full selection with bounded output; a truncated native output cursor is
snapshot-bound. Use it when you require a typed stale-snapshot refusal:

```sh
pm starter consume --mode output --page-tokens 1024 --max-pages 1 --json
```

The host may scan the entire source to construct a page; this recipe bounds
delivered output and invocation count, not host scan memory or time. Native
`pm-rust` read sessions are the separate choice for native snapshot streaming.
This package adds neither a snapshot store nor another pagination layer.

| Outcome | Recovery |
| --- | --- |
| `complete`, `canceled`, `page_limit` | Save returned checkpoint; resume the same stable connection if incomplete. |
| `task_budget` | Resume with a larger cumulative `tokenBudget`; prior spend remains charged. |
| `budget_insufficient` | Inspect retained checkpoint; increase task budget or start a new task with more per-page tokens. No rows from the omitted page were admitted. |
| `host_refused` | Host usage refusal without a native code; check compatibility and budget headroom before retrying the retained checkpoint. A very small native session ceiling can take this path. |
| `cursor_rejected` + `native_code` | Native cursor/snapshot refusal; retain evidence, then restart without checkpoint. Do not silently skip or reset it. |
| `wrong_source` | Use the original tracker connection or explicitly start a new task. |
| `invalid_request` | Correct the bounded schema; no native reads ran. CLI exits 2. |
| `sdk_unavailable` | Use an injected SDK host (2026.10.20+). CLI exits 2. |
| `source_unavailable`, `contract_unavailable` | Restore readable canonical source/host contracts; no unvalidated page was admitted. |
| `observer_failed` | The observer failed after admission; resume the returned checkpoint and reconcile your own external effects. |

Checkpoints are caller-owned JSON, not authenticated capabilities. Keep their
integrity and sourceKey stable. No source status is classified by its name; all
configured statuses are included. Existing custom lifecycle registries, ambient
session focus, bodies, relationships and all other native fields remain owned
by the host and are never written by this recipe. It works in a plain non-git
tracker without a git executable. Host-derived read caches may be populated;
authoritative item, settings and history bytes remain unchanged.

Tests include deterministic page-two cancellation, cancellation before/after each
native read, native stale-output-cursor recovery, producer/output transport fault
injection, strict boundary fuzzing and 500 seeded operation sequences. The model
checks admitted identity prefixes and SDK-read native state after every sequence,
including old checkpoint replays and whitespace/CRLF/relationship fixtures.

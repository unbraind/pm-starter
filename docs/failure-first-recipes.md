# Failure-first task recipes

Run all three reference workflows against an existing tracker:

```sh
pm starter recover --json
pm starter recover --recipe missing-item
pm starter recover --recipe unsupported-capability --output-format toon
pm starter recover --recipe insufficient-budget --json
```

The default selector is `all`. The only SDK input is the strict plain object
`{ recipe?: 'all' | 'missing-item' | 'unsupported-capability' | 'insufficient-budget' }`.
Unknown keys, accessors, arrays (including sparse arrays), nonfinite numbers and
unsupported selectors are rejected. No user-supplied commands or retry arguments
are accepted. Output contains at most three receipts and one safe integer count;
item bodies, titles, paths and native human diagnostics are excluded.

| Intended read | Deliberate refusal | Native contract consumed | Corrected invocation |
| --- | --- | --- | --- |
| Inspect a current item | Look up an absent canonical ID | Host `isItemNotFoundError` classifier and structured `context.nextSteps` | Discover current IDs with `listAllComplete()`, then `get(discoveredId)` |
| Traverse item ancestry | Request the unsupported graph capability `unsupported` | `context.code = unknown_subcommand`, `recovery.allowed_values` includes `ancestors` | `graph('ancestors', { id })` |
| Read the complete tracker | Request `list({ status: 'all', outputBudget: 1 })` | `output_budget_exceeded.reason = requested_budget_infeasible`, `recovery.outputBudget = unbounded` | `listAllComplete()` owns the strict, full, all-status, unbounded retry |

The missing-item recipe uses the SDK's public classifier. pm-cli 2026.10.20 does
not attach `context.code` to this particular SDK error, although its CLI emits
`item_not_found`. The receipt therefore reports `code_source: sdk_classifier`;
it never claims that the SDK emitted a field it did not supply. Guidance strings
are opaque evidence that a remedy exists: no regex extracts IDs, commands or
options from them. Current identity comes from another certified SDK read.

An insufficient output budget is a native omission result, rather than a thrown
exception or nonzero native CLI exit. The recipe asserts that discriminator
before mapping its advertised unbounded remedy to the SDK complete-list helper.
An unsupported graph capability is a core command-domain refusal, rather than an
extension-manifest permission denial. Native core behavior stays in core; these
recipes demonstrate the recovery loop, while the existing laboratories demonstrate
backend read parity.

## SDK example

```ts
import { runFailureFirstRecipes } from 'pm-starter';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk';

/** Use the host-owned SDK rather than resolving another runtime installation. */
export async function recoverRead(ctx: CommandHandlerContext) {
  if (!ctx.sdk) throw new Error('Use a host with ctx.sdk');
  const result = await runFailureFirstRecipes(ctx.sdk, { recipe: 'all' });
  if (!result.ok) throw new Error(result.remediation);
  return result;
}
```

A successful result has schema `pm-starter/failure-first/v1`, `ok: true`, an
initial certified `item_count`, and receipts with `code`, `code_source`, `remedy`,
`retry`, and `recovered: true`. The CLI uses its native JSON/TOON renderer.
Invalid input or a missing host SDK exits 2; empty trackers, incomplete recovery
contracts, unreadable trackers and failed retries exit 1 with a typed code and
remediation. Failure output never contains raw exception text.

## Read-only and concurrency contract

These recipes work in a plain directory without Git or a `pm` executable on
PATH when called through the SDK. Supply at least one real item. They do not
initialize trackers or create fixture items. They introduce no import, export,
sync, journal, idempotency key, status interpretation, claim, lease, budget ledger,
checkpoint, outbox or promotion state. Native SDK reads may maintain their own
derived caches; authoritative item, relationship and history bytes are unchanged.

Every recovery reads current tracker state. A peer can change the tracker
between calls; `item_count` belongs to the initial certified read and does not
promise an atomic snapshot across the recipe. A missing or unreadable retry is
an explicit failure. Existing records remain foreign to these recipes and are
never modified. No retry executes shell text or chooses a mutating graph action.

The real non-git regression tests assert codes/remedies and completion for all
three paths with an empty executable PATH, fingerprint durable data, and inject
peer transitions at every boundary of the missing-item recovery. A seeded
500-sequence read-state model replays old requests against native whitespace/CRLF
bodies, relationships, artifacts, log entries and random custom status names.
Expected state is obtained through the SDK and compared with state read back
through the SDK, without handwritten normalization. Boundary tests separately
fuzz malformed contracts, sparse arrays, oversized strings and numeric extremes.

## Public tracker measurement

Validated a non-git scratch copy of the public `unbraind/pm-starter` tracker at
`4f39fb2e9d207ad47297102bb56a1863568e6e58`. Extension installation finished before
the read-only baseline was taken; authoritative files were then mode 0444.
The executable PATH contained Node and no Git. Both SDK state and durable bytes
were identical after all recipes and both CLI encodings.

| Measurement | Result |
| --- | ---: |
| Certified items, including terminal items | 78 |
| Native graph nodes / deduplicated directed edges | 78 / 11 |
| Public tracker files / bytes before extension setup | 162 / 1,072,404 |
| Native refusal → corrected read loops completed | 3 / 3 |
| Compact SDK JSON bytes, including newline | 617 |
| CLI JSON / TOON bytes | 811 / 455 |
| SDK run elapsed milliseconds, one observation | 1,044 |

The CLI byte counts and exit 0 were identical on the pinned pm-cli 2026.10.20
and current pm-cli 2026.10.25. The SDK run used the pin. Timing is one measurement,
not a performance guarantee. These local filesystem checks do not establish
hosted-provider behavior.

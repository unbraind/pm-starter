/** Read-only recipe composing host pagination and task accounting with caller-owned checkpoints. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { CommandHandlerContext, PmClient, PmReadOutputOptions } from "@unbrained/pm-cli/sdk";
import type { ListOptions } from "@unbrained/pm-cli/sdk/core";

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

const MAX_COUNT = 1_000_000_000;
const MAX_BUDGET = 10_000_000;
const CHECKPOINT_KEYS = ["version", "source", "mode", "page_size", "page_tokens", "token_budget", "spent_tokens", "admitted", "pages", "last_id", "after", "output_cursor", "done"];

/** Read only ordinary data properties, rejecting accessors and hostile or unknown keys. */
function data(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

/** All counts are exact safe integers; floating point quantities never decide admission. */
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

/** Bounded opaque transport values are forwarded unchanged to the host for semantic validation. */
function opaque(value: unknown, maximum: number): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= maximum);
}

/** One strict schema is shared by SDK inputs, CLI inputs and emitted checkpoint validation. */
export function parseConsumerRequest(input: unknown): ConsumerRequest | undefined {
  try {
    const request = data(input, ["mode", "pageSize", "pageTokens", "tokenBudget", "maxPages", "checkpoint"]);
    if (!request) return undefined;
    if (Object.hasOwn(request, "mode") && request.mode !== "producer" && request.mode !== "output") return undefined;
    for (const [key, min, max] of [["pageSize", 1, 128], ["pageTokens", 256, 8192], ["tokenBudget", 256, MAX_BUDGET], ["maxPages", 1, 16]] as const) {
      if (Object.hasOwn(request, key) && !integer(request[key], min, max)) return undefined;
    }
    if (Object.hasOwn(request, "checkpoint")) {
      const c = data(request.checkpoint, CHECKPOINT_KEYS);
      if (!c || Object.keys(c).length !== CHECKPOINT_KEYS.length || c.version !== 1
        || typeof c.source !== "string" || !/^[a-f0-9]{64}$/.test(c.source)
        || (c.mode !== "producer" && c.mode !== "output") || typeof c.done !== "boolean"
        || !integer(c.page_size, 1, 128) || !integer(c.page_tokens, 256, 8192)
        || !integer(c.token_budget, 256, MAX_BUDGET) || !integer(c.spent_tokens, 0, c.token_budget)
        || !integer(c.admitted, 0, MAX_COUNT) || !integer(c.pages, 0, MAX_COUNT)
        || !opaque(c.last_id, 512) || !opaque(c.after, 4096) || !opaque(c.output_cursor, 4096)
        || (c.admitted === 0) !== (c.last_id === null)
        || (c.done && (c.after !== null || c.output_cursor !== null))
        || (c.mode === "output" && c.after !== null)) return undefined;
      if ((Object.hasOwn(request, "mode") && request.mode !== c.mode)
        || (Object.hasOwn(request, "pageSize") && request.pageSize !== c.page_size)
        || (Object.hasOwn(request, "pageTokens") && request.pageTokens !== c.page_tokens)
        || (Object.hasOwn(request, "tokenBudget") && (request.tokenBudget as number) < c.token_budget)) return undefined;
      request.checkpoint = c;
    }
    return request as ConsumerRequest;
  } catch { return undefined; }
}

/** Native error codes are structured discriminators; human prose and arbitrary shell remedies are never parsed. */
function nativeCode(error: unknown): string | undefined {
  const context = (error as { context?: { code?: unknown } } | null)?.context;
  return typeof context?.code === "string" && /^[a-z_]{1,80}$/.test(context.code) ? context.code : undefined;
}

/** Bounded, content-free failures retain the last admitted continuation whenever one exists. */
function refusal(code: Extract<ConsumerResult, { ok: false }>["code"], remedy: string, checkpoint?: ConsumerCheckpoint, native_code?: string): ConsumerResult {
  return { ok: false, exit_code: code === "invalid_request" || code === "sdk_unavailable" ? 2 : 1, code, remedy,
    ...(checkpoint ? { checkpoint: { ...checkpoint } } : {}), ...(native_code ? { native_code } : {}) };
}

/**
 * Admit complete pages into a count/last-identity accumulator. The host owns ordering,
 * cursors, compaction and token accounting. Cancellation never admits a partial page.
 * Only IDs are requested, so no prior full facts need retaining for session suppression.
 * No checkpoint file, lease, source write, external delivery or transaction is hidden here.
 */
export async function consumePaginated(host: ConsumerHost, input: unknown = {}, controls: ConsumerControls = {}): Promise<ConsumerResult> {
  const request = parseConsumerRequest(input);
  if (!request) return refusal("invalid_request", "Use documented finite integer bounds and an unchanged emitted checkpoint; resume may only increase tokenBudget.");
  const source = createHash("sha256").update(host.sourceKey).digest("hex");
  let checkpoint: ConsumerCheckpoint = request.checkpoint ? { ...request.checkpoint, token_budget: request.tokenBudget ?? request.checkpoint.token_budget } : {
    version: 1, source, mode: request.mode ?? "producer", page_size: request.pageSize ?? 16,
    page_tokens: request.pageTokens ?? 2048, token_budget: request.tokenBudget ?? 16000,
    spent_tokens: 0, admitted: 0, pages: 0, last_id: null, after: null, output_cursor: null, done: false,
  };
  if (checkpoint.source !== source) return refusal("wrong_source", "Resume against the original tracker connection, or start a new task without checkpoint.", checkpoint);
  const initialAdmitted = checkpoint.admitted;
  /** Each checkpoint transition is validated before reaching this bounded receipt constructor. */
  function stopped(stop: Extract<ConsumerResult, { ok: true }>["stop"]): ConsumerResult {
    return { ok: true, schema: "pm-starter/paginated-consumer/v1", stop,
      admitted_this_call: checkpoint.admitted - initialAdmitted, checkpoint: { ...checkpoint } };
  }
  for (let call = 0; call < (request.maxPages ?? 4); call++) {
    if (controls.signal?.aborted) return stopped("canceled");
    if (checkpoint.done) return stopped("complete");
    if (checkpoint.token_budget - checkpoint.spent_tokens < 256) return stopped("task_budget");
    const options: ListOptions & PmReadOutputOptions = {
      status: "all", fields: "id", sort: "created_at", order: "asc", strictRead: true,
      ...(checkpoint.mode === "producer" ? { limit: String(checkpoint.page_size) } : { noTruncate: true }),
      outputBudget: checkpoint.page_tokens, outputFormat: "json",
      outputSession: { version: 1, id: `starter-${source.slice(0, 24)}`, token_budget: checkpoint.token_budget,
        spent_tokens: checkpoint.spent_tokens, seen_item_ids: [] },
      ...(checkpoint.after === null ? {} : { after: checkpoint.after }),
      ...(checkpoint.output_cursor === null ? {} : { outputCursor: checkpoint.output_cursor }),
    };
    let page: Awaited<ReturnType<PmClient["list"]>>;
    try { page = await host.client.list(options); }
    catch (error) {
      const code = nativeCode(error);
      const usageRefusal = !code && (error as { exitCode?: unknown } | null)?.exitCode === 2;
      return refusal(code?.includes("cursor") ? "cursor_rejected" : usageRefusal ? "host_refused" : "source_unavailable",
        code?.includes("cursor") ? "Keep this checkpoint for diagnosis; restart without checkpoint against a stable source. Never skip a rejected cursor."
          : usageRefusal ? "The host refused this read without a native code; check host compatibility and budget headroom, then retry the retained checkpoint."
            : "Retry the unchanged checkpoint against a readable initialized tracker.", checkpoint, code);
    }
    const session = page.read_session;
    if (!session || session.spent_before_tokens !== checkpoint.spent_tokens || session.token_budget !== checkpoint.token_budget
      || !integer(session.spent_total_tokens, checkpoint.spent_tokens, checkpoint.token_budget)
      || !integer(session.charged_this_call_tokens, 0, checkpoint.token_budget - checkpoint.spent_tokens)
      || session.spent_total_tokens !== checkpoint.spent_tokens + session.charged_this_call_tokens) {
      return refusal("contract_unavailable", "Use a host that returns canonical output-session accounting.", checkpoint);
    }
    checkpoint = { ...checkpoint, spent_tokens: session.spent_total_tokens };
    // An in-flight read is charged even if cancellation means none of its rows are admitted.
    if (controls.signal?.aborted) return stopped("canceled");
    if ("output_budget_exceeded" in page) return refusal("budget_insufficient", "Start with a larger pageTokens, or resume with a larger tokenBudget when the task ceiling was exhausted.", checkpoint);
    if (!Array.isArray(page.items) || page.items.length > 4096 || page.completeness?.status === "partial") {
      return refusal("contract_unavailable", "Require a readable source and the canonical bounded list row contract.", checkpoint);
    }
    const ids: string[] = [];
    for (let index = 0; index < page.items.length; index++) {
      const row = page.items[index];
      if (!Object.hasOwn(page.items, index) || !row || typeof row.id !== "string" || !opaque(row.id, 512) || ids.includes(row.id)) {
        return refusal("contract_unavailable", "Require dense rows with unique stable identities; retry without admitting this page.", checkpoint);
      }
      ids.push(row.id);
    }
    const continuation = page as typeof page & { continuation_kind?: string };
    const output = continuation.continuation_kind === "output_cursor";
    const cursor = page.next_cursor;
    // Producer continuations legally omit repeated first-page metadata, including has_more.
    const referenced = checkpoint.after !== null && "continuation_contract" in page
      && (page.continuation_contract as { metadata?: unknown }).metadata === "reference";
    const hasMore = typeof page.has_more === "boolean" ? page.has_more : referenced ? cursor !== null : undefined;
    if (hasMore === undefined || (hasMore && (ids.length === 0 || typeof cursor !== "string" || !opaque(cursor, 4096)))
      || (!hasMore && cursor !== null)) return refusal("contract_unavailable", "Require an advancing host continuation for every incomplete page.", checkpoint);
    const next: ConsumerCheckpoint = { ...checkpoint, admitted: checkpoint.admitted + ids.length,
      pages: checkpoint.pages + 1, last_id: ids.at(-1) ?? checkpoint.last_id, done: !hasMore,
      after: hasMore ? (output ? checkpoint.after : cursor) : null,
      output_cursor: hasMore && output ? cursor : null };
    if (!parseConsumerRequest({ checkpoint: next }) || (hasMore && next.after === checkpoint.after && next.output_cursor === checkpoint.output_cursor)) {
      return refusal("contract_unavailable", "Require an advancing, bounded host cursor; this page was not admitted.", checkpoint);
    }
    checkpoint = next;
    try { controls.onPage?.(Object.freeze(ids), Object.freeze({ ...checkpoint })); }
    catch { return refusal("observer_failed", "This page was already admitted; resume this checkpoint. Observers must not implement unjournaled external delivery.", checkpoint); }
  }
  return stopped(controls.signal?.aborted ? "canceled" : checkpoint.done ? "complete" : "page_limit");
}

/** Normalize CLI transport spellings only; all domain validation belongs to parseConsumerRequest. */
export async function runConsumerCommand(ctx: Pick<CommandHandlerContext, "options" | "sdk" | "pm_root">): Promise<ConsumerResult> {
  const input: Record<string, unknown> = {};
  for (const [flag, key] of [["mode", "mode"], ["page-size", "pageSize"], ["page-tokens", "pageTokens"], ["token-budget", "tokenBudget"], ["max-pages", "maxPages"], ["checkpoint", "checkpoint"]]) {
    const value = Object.hasOwn(ctx.options, key) ? ctx.options[key] : ctx.options[flag];
    if (value === undefined && !Object.hasOwn(ctx.options, flag) && !Object.hasOwn(ctx.options, key)) continue;
    if (key === "checkpoint" && typeof value === "string" && value.length <= 16384) {
      try { input[key] = JSON.parse(value); } catch { return refusal("invalid_request", "Pass --checkpoint the JSON object emitted by this recipe."); }
    } else if (key !== "mode" && key !== "checkpoint" && typeof value === "string" && /^[0-9]{1,9}$/.test(value)) input[key] = Number(value);
    else input[key] = value;
  }
  if (!parseConsumerRequest(input)) return refusal("invalid_request", "Use --mode producer|output, --page-size 1..128, --page-tokens 256..8192, --token-budget 256..10000000, --max-pages 1..16 and an emitted JSON checkpoint.");
  if (!ctx.sdk) return refusal("sdk_unavailable", "Use a pm host that injects ctx.sdk (pm-cli >=2026.10.20).");
  const controller = new AbortController();
  /** Finish the current read, account its budget and return the last admission boundary. */
  const cancel = () => { controller.abort(); };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try { return await consumePaginated({ client: ctx.sdk.client, sourceKey: resolve(ctx.pm_root) }, input, { signal: controller.signal }); }
  finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}

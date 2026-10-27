/**
 * Consumer-example cost baselines for extension authors.
 *
 * Measures tool calls, delivered UTF-8 bytes and elapsed work for fixed
 * orientation, targeted-read and resume scenarios. Answers are checked
 * identically on the directory client and a synthetic remote clone. This is
 * not a model-performance claim, an external capture accounting tool, or a
 * native operation benchmark.
 */
import { createHash } from "node:crypto";
/** Report schema shared by the producer and the validator. */
export const TASK_COST_REPORT_SCHEMA = "pm-starter/task-cost-report/v1";
/** Declaration schema shared by import, export and the measurement producer. */
export const TASK_COST_DECLARATION_SCHEMA = "pm-starter/task-cost-baseline/v1";
/** Maximum repeats. Distributions stay bounded for agent output. */
export const TASK_COST_MAX_REPEATS = 8;
/** Maximum resume pages so a large corpus cannot loop without a checkpoint. */
export const TASK_COST_MAX_RESUME_PAGES = 8;
/** Resume page size. Two pages are enough to prove continuation on fleet trackers. */
export const TASK_COST_RESUME_LIMIT = 50;
/** Corpus observation refuses above this certified item count. */
export const TASK_COST_MAX_CORPUS_ITEMS = 5000;
const SCENARIOS = ["orientation", "targeted-read", "resume"];
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ANSWER_PATTERN = /^[a-z0-9:,=_-]{1,512}$/u;
/** Stable lexical ordering shared by digest and answer producers. */
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
/** Describe the executing engine; accepts a version map for portable consumers and tests. */
export function taskCostRuntime(versions) {
    return { engine: versions.bun ? "bun" : "node", version: versions.bun ?? versions.node };
}
/**
 * Contract failure inside a producer, mapped to a typed refusal by the runner.
 * The message is a stable remedy, not a native diagnostic.
 */
export class TaskCostContractError extends Error {
    /** Stable refusal code the runner copies onto the result. */
    code;
    /**
     * Create a producer-side contract failure.
     *
     * @param code - Refusal code the public result will carry.
     * @param remediation - Fixed remedy, without native error text.
     */
    constructor(code, remediation) {
        super(remediation);
        this.name = "TaskCostContractError";
        this.code = code;
    }
}
/**
 * Reduce a ratio with Euclid's algorithm.
 *
 * @param left - Non-negative integer.
 * @param right - Non-negative integer.
 * @returns Greatest common divisor, or 0 when both inputs are 0.
 */
function greatestDivisor(left, right) {
    let a = left;
    let b = right;
    while (b !== 0) {
        const next = a % b;
        a = b;
        b = next;
    }
    return a;
}
/**
 * Build a reduced exact ratio. The denominator is always positive.
 *
 * @param numerator - Safe integer.
 * @param denominator - Non-zero safe integer.
 * @returns Reduced rational.
 */
export function exactRational(numerator, denominator = 1) {
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
        throw new TaskCostContractError("report_invalid", "Measured quantities must be safe integers; retry the baseline.");
    }
    const sign = denominator < 0 ? -1 : 1;
    const divisor = greatestDivisor(Math.abs(numerator), Math.abs(denominator));
    return { n: numerator === 0 ? 0 : sign * (numerator / divisor), d: Math.abs(denominator / divisor) };
}
/**
 * Compare two rationals by cross-multiplication in bigint, so 1/2 and 2/4 match
 * and a binary float cannot round an inclusive boundary the wrong way.
 *
 * @param left - Exact ratio.
 * @param right - Exact ratio.
 * @returns -1, 0 or 1.
 */
export function rationalCompare(left, right) {
    const leftCross = BigInt(left.n) * BigInt(right.d);
    const rightCross = BigInt(right.n) * BigInt(left.d);
    if (leftCross < rightCross)
        return -1;
    if (leftCross > rightCross)
        return 1;
    return 0;
}
/**
 * Median of a non-empty bounded sample. Even counts use the exact mean of the
 * two central integers, stored as a ratio rather than a float.
 *
 * @param samples - Safe non-negative integers, length 1 to 8.
 * @returns Exact median.
 */
export function exactMedian(samples) {
    if (samples.length < 1 || samples.length > TASK_COST_MAX_REPEATS) {
        throw new TaskCostContractError("report_invalid", "Repeat the baseline with 1 to 8 samples.");
    }
    for (const sample of samples) {
        if (!Number.isSafeInteger(sample) || sample < 0) {
            throw new TaskCostContractError("report_invalid", "Measured quantities must be non-negative safe integers.");
        }
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const mid = sorted.length >> 1;
    if (sorted.length % 2 === 1)
        return exactRational(sorted[mid]);
    const lower = sorted[mid - 1];
    const upper = sorted[mid];
    return exactRational(lower + upper, 2);
}
/**
 * Render a non-negative rational for display only. Decisions must use {@link rationalCompare}.
 *
 * @param value - Reduced non-negative ratio.
 * @returns A decimal string with at most three fractional digits.
 */
export function formatRational(value) {
    const whole = Math.trunc(value.n / value.d);
    const remainder = value.n % value.d;
    if (remainder === 0)
        return String(whole);
    return `${whole}.${String(Math.trunc((remainder * 1000) / value.d)).padStart(3, "0").replace(/0+$/u, "")}`;
}
/**
 * Label an exact byte count divided by 4 as an estimate.
 *
 * @param bytes - Delivered UTF-8 byte count, or an exact median of counts.
 * @returns Labeled estimate. The display string is not a decision input.
 */
export function bytesDiv4Estimate(bytes) {
    const ratio = typeof bytes === "number" ? exactRational(bytes, 4) : exactRational(bytes.n, bytes.d * 4);
    return { label: "estimate", method: "bytes_div_4", value: ratio, display: formatRational(ratio) };
}
/**
 * Subtract two rationals with bigint cross-multiplication so a half-step median stays exact.
 *
 * @param left - Minuend.
 * @param right - Subtrahend.
 * @returns Reduced difference.
 */
export function subtractRationals(left, right) {
    const numerator = BigInt(left.n) * BigInt(right.d) - BigInt(right.n) * BigInt(left.d);
    const denominator = BigInt(left.d) * BigInt(right.d);
    if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || numerator < BigInt(-Number.MAX_SAFE_INTEGER) || denominator > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new TaskCostContractError("report_invalid", "Budget delta was outside the safe integer domain; retry a smaller corpus.");
    }
    return exactRational(Number(numerator), Number(denominator));
}
/**
 * Integer ceiling of a non-negative rational. Used only to label the SDK's ceil(bytes/4) estimate.
 *
 * @param value - Non-negative exact ratio.
 * @returns Smallest integer greater than or equal to the ratio.
 */
export function ceilRational(value) {
    if (value.n < 0 || value.d < 1)
        throw new TaskCostContractError("report_invalid", "Ceil estimates require a non-negative ratio.");
    const numerator = BigInt(value.n);
    const denominator = BigInt(value.d);
    const quotient = numerator / denominator;
    return Number(numerator % denominator === 0n ? quotient : quotient + 1n);
}
/**
 * Integer ceiling of bytes/4, matching the SDK estimator's documented formula.
 * It is still an estimate and is not consulted by budget decisions.
 *
 * @param bytes - Delivered UTF-8 byte count.
 * @returns Ceil(bytes/4) as a safe integer.
 */
export function ceilBytesDiv4(bytes) {
    return ceilRational(exactRational(bytes, 4));
}
/**
 * Decide whether a wasted run is strictly more expensive in both calls and bytes.
 * Comparison uses exact rationals, including when the median is a half-step.
 *
 * @param cleanCalls - Clean-run call median.
 * @param cleanBytes - Clean-run byte median.
 * @param wastedCalls - Wasted-run call median.
 * @param wastedBytes - Wasted-run byte median.
 * @returns True only when both quantities strictly increase.
 */
export function budgetWorsened(cleanCalls, cleanBytes, wastedCalls, wastedBytes) {
    return rationalCompare(wastedCalls, cleanCalls) > 0 && rationalCompare(wastedBytes, cleanBytes) > 0;
}
/**
 * Build role sets from SDK-delivered role names. Status ids are stored only as
 * members of those sets; they are never tested with string equality against "open" or "done".
 *
 * @param definitions - Dense status definitions from `schemaList`.
 * @returns Lookup index and the registry's default-open status id.
 */
export function indexStatusRoles(definitions) {
    const byToken = new Map();
    const add = (token, id) => {
        const normalized = token;
        if (normalized.length > 0 && !byToken.has(normalized))
            byToken.set(normalized, id);
    };
    const active = new Set();
    const blocked = new Set();
    const done = new Set();
    const canceled = new Set();
    const terminal = new Set();
    let openStatusId = "";
    for (const definition of definitions) {
        add(definition.id, definition.id);
        for (const alias of definition.aliases) {
            add(alias, definition.id);
        }
        const roles = new Set(definition.roles);
        if (roles.has("active"))
            active.add(definition.id);
        if (roles.has("blocked"))
            blocked.add(definition.id);
        if (roles.has("terminal_done"))
            done.add(definition.id);
        if (roles.has("terminal_canceled"))
            canceled.add(definition.id);
        if (roles.has("terminal") || roles.has("terminal_done") || roles.has("terminal_canceled"))
            terminal.add(definition.id);
        if (openStatusId.length === 0 && roles.has("default_open"))
            openStatusId = definition.id;
    }
    if (openStatusId.length === 0) {
        openStatusId = definitions.find((definition) => definition.roles.includes("active"))?.id ?? "";
    }
    if (openStatusId.length === 0)
        throw new TaskCostContractError("status_registry_unavailable", "Configure a status with the default_open or active role, then retry.");
    return { byToken, active, blocked, done, canceled, terminal, openStatusId };
}
/**
 * Resolve a status token to its registry id. Unknown tokens stay unresolved.
 *
 * @param status - Status text from an SDK row.
 * @param index - Role index built from the current registry.
 * @returns Registry id, or undefined when the registry has no such status.
 */
export function resolveStatusId(status, index) {
    return index.byToken.get(status);
}
/**
 * Primary role used inside answer hashes. Membership still comes from the role sets.
 *
 * @param statusId - Resolved registry id.
 * @param index - Role index.
 * @returns One role name from the registry vocabulary, or unassigned.
 */
function primaryRole(statusId, index) {
    if (statusId !== undefined && index.canceled.has(statusId))
        return "canceled";
    if (statusId !== undefined && index.done.has(statusId))
        return "done";
    if (statusId !== undefined && index.terminal.has(statusId))
        return "terminal";
    if (statusId !== undefined && index.blocked.has(statusId))
        return "blocked";
    if (statusId !== undefined && index.active.has(statusId))
        return "active";
    return "unassigned";
}
/**
 * Read a plain own-property record. Arrays, null and exotic prototypes are rejected.
 *
 * @param value - Untrusted value.
 * @returns The object, or undefined.
 */
function plainRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return undefined;
    if (Object.getPrototypeOf(value) !== Object.prototype)
        return undefined;
    return value;
}
/**
 * Read a dense string array. Sparse holes and non-strings fail closed.
 *
 * @param value - Untrusted value.
 * @param max - Maximum accepted length.
 * @returns The strings, or undefined.
 */
function denseStrings(value, max) {
    if (!Array.isArray(value) || value.length > max)
        return undefined;
    const out = [];
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index) || typeof value[index] !== "string")
            return undefined;
        out.push(value[index]);
    }
    return out;
}
/**
 * Parse `schemaList` statuses without accepting a hand-built role policy.
 *
 * @param value - SDK `schemaList` result.
 * @returns Dense definitions, or undefined when the payload is not the SDK shape.
 */
export function parseSchemaListStatuses(value) {
    const root = plainRecord(value);
    const statuses = plainRecord(root?.statuses);
    if (!statuses)
        return undefined;
    const groups = [statuses.builtin, statuses.custom];
    const definitions = [];
    for (const group of groups) {
        if (!Array.isArray(group))
            return undefined;
        for (let index = 0; index < group.length; index += 1) {
            if (!Object.hasOwn(group, index))
                return undefined;
            const row = plainRecord(group[index]);
            if (!row || typeof row.id !== "string" || row.id.length === 0 || row.id.length > 64)
                return undefined;
            const aliases = denseStrings(row.aliases, 32);
            const roles = denseStrings(row.roles, 16);
            if (!aliases || !roles)
                return undefined;
            definitions.push({ id: row.id, aliases, roles });
        }
    }
    return definitions;
}
/**
 * Collect focus rows from an orientation context. Session references without a status are refused.
 *
 * @param value - SDK context result.
 * @returns Rows in delivery order.
 */
function orientationRows(value) {
    const root = plainRecord(value);
    const intent = plainRecord(root?.context_intent);
    if (intent?.intent !== "orient" || intent.command !== "context") {
        throw new TaskCostContractError("orientation_contract_unavailable", "Use a pm host that applies the context orient intent (pm-cli >=2026.10.23), then retry.");
    }
    const rows = [];
    for (const key of ["high_level", "low_level", "blocked_fallback"]) {
        const collection = root?.[key];
        if (!Array.isArray(collection))
            throw new TaskCostContractError("orientation_contract_unavailable", "Retry orientation on a host whose context result includes focus collections.");
        for (let index = 0; index < collection.length; index += 1) {
            if (!Object.hasOwn(collection, index))
                throw new TaskCostContractError("orientation_contract_unavailable", "Retry orientation; a focus collection was sparse.");
            const row = plainRecord(collection[index]);
            if (!row || typeof row.id !== "string" || typeof row.status !== "string") {
                throw new TaskCostContractError("orientation_contract_unavailable", "Retry orientation without an output session so each focus row includes id and status.");
            }
            rows.push({ id: row.id, status: row.status });
        }
    }
    return rows;
}
/**
 * Canonical orientation answer: role counts plus a hash of id/role pairs.
 *
 * @param rows - Delivered focus rows.
 * @param index - Current status registry.
 * @returns Stable answer token.
 */
export function orientationAnswer(rows, index) {
    const counts = { active: 0, blocked: 0, done: 0, canceled: 0, terminal: 0 };
    const pairs = [];
    for (const row of [...rows].sort((left, right) => compareText(left.id, right.id))) {
        const statusId = resolveStatusId(row.status, index);
        if (statusId !== undefined && index.active.has(statusId))
            counts.active += 1;
        if (statusId !== undefined && index.blocked.has(statusId))
            counts.blocked += 1;
        if (statusId !== undefined && index.done.has(statusId))
            counts.done += 1;
        if (statusId !== undefined && index.canceled.has(statusId))
            counts.canceled += 1;
        if (statusId !== undefined && index.terminal.has(statusId))
            counts.terminal += 1;
        pairs.push(`${row.id}:${primaryRole(statusId, index)}`);
    }
    const focus = createHash("sha256").update(pairs.join("\n")).digest("hex");
    return `orientation:active=${counts.active},blocked=${counts.blocked},done=${counts.done},canceled=${counts.canceled},terminal=${counts.terminal},focus=${focus}`;
}
/**
 * Answer for one targeted get: the id and its registry role, not the status name.
 *
 * @param id - Requested item id.
 * @param status - Status text from the SDK get.
 * @param index - Current status registry.
 * @returns Stable answer token.
 */
export function targetedAnswer(id, status, index) {
    return `targeted-read:id=${id},role=${primaryRole(resolveStatusId(status, index), index)}`;
}
/**
 * Answer for a resumed page sequence. Duplicate ids are visible in the token.
 *
 * @param pages - Number of SDK pages read.
 * @param ids - Ids in delivery order, including duplicates if the cursor misbehaves.
 * @param index - Current status registry.
 * @param statuses - Status text parallel to `ids`.
 * @returns Stable answer token.
 */
export function resumeAnswer(pages, ids, statuses, index) {
    const seen = new Set();
    let duplicates = 0;
    const pairs = [];
    for (let cursor = 0; cursor < ids.length; cursor += 1) {
        const id = ids[cursor];
        if (seen.has(id))
            duplicates += 1;
        seen.add(id);
        pairs.push(`${id}:${primaryRole(resolveStatusId(statuses[cursor] ?? "", index), index)}`);
    }
    pairs.sort(compareText);
    const digest = createHash("sha256").update(pairs.join("\n")).digest("hex");
    return `resume:pages=${pages},rows=${ids.length},duplicates=${duplicates},ids=${digest}`;
}
/**
 * Digest the certified corpus without putting item bodies into the answer.
 *
 * @param items - Certified complete-list rows.
 * @returns `digest:` plus a hex sha256 of id, status and updated_at.
 */
export function corpusDigest(items) {
    const lines = [...items].sort((left, right) => compareText(left.id, right.id))
        .map((item) => `${item.id}\t${item.status}\t${item.updated_at}`);
    return `digest:${createHash("sha256").update(lines.join("\n")).digest("hex")}`;
}
/**
 * Measure one SDK call. Bytes are the UTF-8 length of the JSON the agent would receive.
 *
 * @param meter - Accumulator for this execution.
 * @param tool - Stable tool name.
 * @param read - Host SDK call.
 * @returns The SDK result.
 */
async function measureCall(meter, tool, read) {
    const started = process.hrtime.bigint();
    const result = await read();
    const elapsed = process.hrtime.bigint() - started;
    if (elapsed < 0n || elapsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new TaskCostContractError("report_invalid", "Elapsed work was not a safe integer; retry the baseline.");
    }
    const bytes = Buffer.byteLength(JSON.stringify(result));
    meter.calls += 1;
    meter.bytes += bytes;
    meter.elapsedNs += Number(elapsed);
    meter.tools.push(tool);
    return result;
}
/**
 * Load the tracker's status registry through the injected client.
 *
 * @param client - Host client.
 * @param meter - Optional meter; omitted for corpus observation.
 * @returns Role index.
 */
async function loadRoles(client, meter) {
    const listed = await measureCall(meter, "schemaList", () => client.schemaList());
    const definitions = parseSchemaListStatuses(listed);
    if (!definitions || definitions.length === 0) {
        throw new TaskCostContractError("status_registry_unavailable", "Retry with a host whose schemaList returns builtin and custom status roles.");
    }
    return indexStatusRoles(definitions);
}
/**
 * Run orientation: one context orient read plus the registry lookup.
 *
 * @param client - Host client.
 * @param meter - Call meter.
 * @returns Answer token.
 */
async function runOrientation(client, meter) {
    const index = await loadRoles(client, meter);
    const context = await measureCall(meter, "context", () => client.context({ for: "orient" }));
    return orientationAnswer(orientationRows(context), index);
}
/**
 * Run a single get. A missing item is a typed refusal, not an empty answer.
 *
 * @param client - Host client.
 * @param meter - Call meter.
 * @param targetId - Declared item id.
 * @param host - Classifier for the native missing-item error.
 * @returns Answer token.
 */
async function runTargeted(client, meter, targetId, host) {
    const index = await loadRoles(client, meter);
    let result;
    try {
        result = await measureCall(meter, "get", () => client.get(targetId, { fields: "id,status", outputBudget: "unbounded" }));
    }
    catch (error) {
        if (host.isItemNotFoundError?.(error) === true) {
            throw new TaskCostContractError("item_not_found", "Pass --target-id of an item that exists in this corpus, then retry targeted-read.");
        }
        throw new TaskCostContractError("source_unavailable", "Retry targeted-read against a readable initialized tracker.");
    }
    const item = plainRecord(plainRecord(result)?.item);
    if (!item || typeof item.id !== "string" || typeof item.status !== "string") {
        throw new TaskCostContractError("item_not_found", "Pass --target-id of an item that exists in this corpus, then retry targeted-read.");
    }
    return targetedAnswer(item.id, item.status, index);
}
/**
 * Read list pages until the SDK cursor is exhausted, checkpointing `next_cursor` between calls.
 *
 * @param client - Host client.
 * @param meter - Call meter.
 * @returns Answer token.
 */
async function runResume(client, meter) {
    const index = await loadRoles(client, meter);
    const ids = [];
    const statuses = [];
    let after;
    let pages = 0;
    while (pages < TASK_COST_MAX_RESUME_PAGES) {
        const page = await measureCall(meter, "list", () => client.list({
            status: "all",
            limit: String(TASK_COST_RESUME_LIMIT),
            fields: "id,status",
            outputBudget: "unbounded",
            outputLimit: "unbounded",
            ...(after ? { after } : {}),
        }));
        const root = plainRecord(page);
        const items = root?.items;
        if (!Array.isArray(items))
            throw new TaskCostContractError("resume_contract_unavailable", "Retry resume on a host whose list result includes an items array and next_cursor.");
        for (let indexCursor = 0; indexCursor < items.length; indexCursor += 1) {
            if (!Object.hasOwn(items, indexCursor))
                throw new TaskCostContractError("resume_contract_unavailable", "Retry resume; a list page was sparse.");
            const row = plainRecord(items[indexCursor]);
            if (!row || typeof row.id !== "string" || typeof row.status !== "string") {
                throw new TaskCostContractError("resume_contract_unavailable", "Retry resume with field projection id,status so each row is classifiable.");
            }
            ids.push(row.id);
            statuses.push(row.status);
        }
        pages += 1;
        if (root?.has_more !== undefined && typeof root.has_more !== "boolean")
            throw new TaskCostContractError("resume_contract_unavailable", "Retry with a host that reports a valid list continuation.");
        const cursor = root?.next_cursor;
        if (cursor === null)
            return resumeAnswer(pages, ids, statuses, index);
        if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 4096) {
            throw new TaskCostContractError("resume_contract_unavailable", "Retry resume; the host omitted a producer next_cursor while has_more was true.");
        }
        if (cursor === after || items.length === 0)
            throw new TaskCostContractError("resume_contract_unavailable", "Retry with a progressing cursor and a non-empty continuation page.");
        after = cursor;
    }
    throw new TaskCostContractError("resume_contract_unavailable", "Narrow the corpus or raise the documented page cap; resume stopped after 8 pages.");
}
/**
 * Certified corpus snapshot used only to pin version and choose a default target.
 * Its call is reported separately and is not part of the scenario budget.
 *
 * @param client - Host client.
 * @returns Items, digest and the byte size of the observation.
 */
async function observeCorpus(client) {
    const listed = await client.listAllComplete();
    const bytes = Buffer.byteLength(JSON.stringify(listed));
    const count = listed.complete_list?.item_count;
    if (!Number.isSafeInteger(count) || count < 0 || count !== listed.items.length || count > TASK_COST_MAX_CORPUS_ITEMS) {
        throw new TaskCostContractError("source_unavailable", "Use a certified tracker with at most 5000 items, then retry.");
    }
    const items = listed.items.map((item) => {
        if (typeof item.id !== "string" || typeof item.status !== "string" || typeof item.updated_at !== "string") {
            throw new TaskCostContractError("source_unavailable", "Retry against a certified complete list with id, status and updated_at.");
        }
        return { id: item.id, status: item.status, updated_at: item.updated_at };
    });
    return { items, digest: corpusDigest(items), bytes };
}
/**
 * Clone SDK results so the synthetic runtime cannot share object identity with the directory runtime.
 *
 * @param client - Directory client.
 * @returns Client whose methods return structured clones.
 */
export function syntheticRemoteClient(client) {
    const reads = new Set(["context", "get", "list", "listAllComplete", "schemaList"]);
    return new Proxy({}, {
        /** Bind the native read allowlist and isolate each delivered object. */
        get(_target, property) {
            if (!reads.has(property))
                return undefined;
            const method = client[property];
            return async (...args) => structuredClone(await Reflect.apply(method, client, args));
        },
    });
}
/**
 * Execute one scenario once, optionally appending a certified full list.
 *
 * @param client - Runtime client.
 * @param scenario - Fixed scenario.
 * @param targetId - Required for targeted-read.
 * @param host - Missing-item classifier.
 * @param injectFullList - When true, add one `listAllComplete` inside the meter.
 * @returns Answer and meter totals.
 */
async function executeOnce(client, scenario, targetId, host, injectFullList) {
    const meter = { calls: 0, bytes: 0, elapsedNs: 0, tools: [] };
    const answer = scenario === "orientation" ? await runOrientation(client, meter)
        : scenario === "targeted-read" ? await runTargeted(client, meter, targetId, host)
            : await runResume(client, meter);
    if (injectFullList)
        await measureCall(meter, "listAllComplete", () => client.listAllComplete());
    return { answer, calls: meter.calls, bytes: meter.bytes, elapsedNs: meter.elapsedNs, tools: meter.tools };
}
/**
 * Repeat a scenario on one runtime and require every repeat to return the same answer.
 *
 * @param client - Runtime client.
 * @param scenario - Fixed scenario.
 * @param repeats - Sample size.
 * @param targetId - Targeted-read id.
 * @param host - Classifier.
 * @param injectFullList - Waste probe switch.
 * @returns Samples and the shared answer.
 */
async function repeatScenario(client, scenario, repeats, targetId, host, injectFullList) {
    const calls = [];
    const bytes = [];
    const elapsed = [];
    let answer = "";
    let tools = [];
    for (let index = 0; index < repeats; index += 1) {
        const sample = await executeOnce(client, scenario, targetId, host, injectFullList);
        if (index === 0) {
            answer = sample.answer;
            tools = sample.tools;
        }
        else if (sample.answer !== answer || sample.tools.join(",") !== tools.join(",")) {
            throw new TaskCostContractError("runtime_answer_mismatch", "Repeat the baseline on an unchanged corpus; a repeat disagreed with the first answer.");
        }
        calls.push(sample.calls);
        bytes.push(sample.bytes);
        elapsed.push(sample.elapsedNs);
    }
    return { answer, calls, bytes, elapsed, tools };
}
/**
 * Build a distribution and its labeled byte/4 estimate from finished samples.
 *
 * @param calls - Call samples.
 * @param bytes - Byte samples.
 * @param elapsed - Elapsed nanosecond samples.
 * @returns Distributions plus the estimate of the byte median.
 */
function distributions(calls, bytes, elapsed) {
    const callMedian = exactMedian(calls);
    const byteMedian = exactMedian(bytes);
    const elapsedMedian = exactMedian(elapsed);
    const estimate = bytesDiv4Estimate(byteMedian);
    return {
        calls: { min: Math.min(...calls), max: Math.max(...calls), median: callMedian, samples: calls },
        delivered_bytes: { min: Math.min(...bytes), max: Math.max(...bytes), median: byteMedian, samples: bytes },
        elapsed_ns: { min: Math.min(...elapsed), max: Math.max(...elapsed), median: elapsedMedian, samples: elapsed },
        estimate,
        ceil: ceilRational(estimate.value),
    };
}
/** Validate all emitted numeric leaves, including probe ratios, before returning success. */
function assertFiniteTree(value) {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
        throw new TaskCostContractError("report_invalid", "Report numbers must be non-negative safe integers.");
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            if (!Object.hasOwn(value, index))
                throw new TaskCostContractError("report_invalid", "Report arrays must be dense.");
            assertFiniteTree(value[index]);
        }
    }
    else if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            assertFiniteTree(child);
        if ("n" in value && "d" in value && value.d < 1)
            throw new TaskCostContractError("report_invalid", "Ratio denominators must be positive.");
    }
}
/**
 * Validate a finished report with the same numeric domain the producer uses.
 * A bad scenario fails alone: the function reports the scenario name instead of discarding siblings.
 *
 * @param report - Producer output.
 * @returns The same report when every number is finite and in domain.
 */
export function assertTaskCostReport(report) {
    assertFiniteTree(report);
    if (report.schema !== TASK_COST_REPORT_SCHEMA || report.ok !== true || report.not_model_performance !== true || report.process_calls !== 0 || report.process_scope !== "package_spawned_children") {
        throw new TaskCostContractError("report_invalid", "Rebuild the report with the package producer; the schema discriminator was absent.");
    }
    if (!Number.isSafeInteger(report.corpus_observation.delivered_bytes) || report.corpus_observation.delivered_bytes < 0 || report.corpus_observation.calls !== 2 || report.corpus_observation.excluded_from_scenario_budget !== true) {
        throw new TaskCostContractError("report_invalid", "Corpus observation must stay outside the scenario budget.");
    }
    if (report.scenarios.length < 1 || report.scenarios.length > SCENARIOS.length) {
        throw new TaskCostContractError("report_invalid", "A report contains 1 to 3 scenario rows.");
    }
    for (const scenario of report.scenarios) {
        if (scenario.answer !== scenario.expected_answer || scenario.answer_ok !== true || scenario.identical_answer !== true) {
            throw new TaskCostContractError("answer_mismatch", `Re-declare ${scenario.scenario}; the checked answer did not match the corpus.`);
        }
        if (scenario.estimate.label !== "estimate" || scenario.estimate.method !== "bytes_div_4" || scenario.ceil_estimate.label !== "estimate" || scenario.ceil_estimate.method !== "ceil(utf8_bytes / 4)" || scenario.estimate.display !== formatRational(scenario.estimate.value)) {
            throw new TaskCostContractError("report_invalid", "Label byte/4 figures as estimates before returning ok.");
        }
        const medianBytes = scenario.delivered_bytes.median;
        if (rationalCompare(scenario.estimate.value, exactRational(medianBytes.n, medianBytes.d * 4)) !== 0 || scenario.ceil_estimate.value !== ceilRational(scenario.estimate.value)) {
            throw new TaskCostContractError("report_invalid", "The byte/4 estimate must be the byte median over 4, and the ceil label must match that ratio.");
        }
        if (!parseTaskCostDeclaration(report.declarations[report.scenarios.indexOf(scenario)]))
            throw new TaskCostContractError("report_invalid", "Every row must emit a valid replayable declaration.");
        if (scenario.elapsed_use !== "display_only") {
            throw new TaskCostContractError("report_invalid", "Elapsed work is display-only and cannot decide the budget.");
        }
        for (const distribution of [scenario.calls, scenario.delivered_bytes, scenario.elapsed_ns, scenario.synthetic_remote.calls, scenario.synthetic_remote.delivered_bytes, scenario.synthetic_remote.elapsed_ns]) {
            if (distribution.samples.length < 1 || Math.min(...distribution.samples) !== distribution.min || Math.max(...distribution.samples) !== distribution.max) {
                throw new TaskCostContractError("report_invalid", "Distribution min and max must match the samples.");
            }
            if (rationalCompare(distribution.median, exactMedian(distribution.samples)) !== 0) {
                throw new TaskCostContractError("report_invalid", "Distribution median must be the exact sample median.");
            }
        }
    }
    if (report.probe) {
        if (report.probe.worsened !== true || report.probe.injected !== "listAllComplete" || !budgetWorsened(report.probe.clean_calls, report.probe.clean_bytes, report.probe.wasted_calls, report.probe.wasted_bytes) || rationalCompare(report.probe.delta_calls, subtractRationals(report.probe.wasted_calls, report.probe.clean_calls)) !== 0 || rationalCompare(report.probe.delta_bytes, subtractRationals(report.probe.wasted_bytes, report.probe.clean_bytes)) !== 0) {
            throw new TaskCostContractError("budget_not_worsened", "The extra full-list probe must strictly increase both calls and bytes.");
        }
    }
    return report;
}
/**
 * Refuse with a fixed remedy and no native exception text.
 *
 * @param code - Refusal code.
 * @param remediation - Fixed remedy.
 * @param exitCode - 2 for usage, 1 for a failed run.
 * @returns Refusal result.
 */
function refuse(code, remediation, exitCode = 1) {
    return { ok: false, schema: TASK_COST_REPORT_SCHEMA, exit_code: exitCode, code, remediation };
}
/**
 * Parse one untrusted declaration. Unknown keys, sparse data and non-finite numbers fail.
 *
 * @param input - Untrusted value.
 * @returns Canonical declaration, or undefined.
 */
export function parseTaskCostDeclaration(input) {
    const root = plainRecord(input);
    if (!root)
        return undefined;
    const allowed = new Set(["schema", "id", "scenario", "corpus", "expected_answer", "repeats", "target_id"]);
    if (Reflect.ownKeys(root).some((key) => typeof key !== "string" || !allowed.has(key)))
        return undefined;
    if (root.schema !== TASK_COST_DECLARATION_SCHEMA)
        return undefined;
    const id = canonicalToken(root.id, 64);
    const scenario = root.scenario;
    if (!id || !ID_PATTERN.test(id))
        return undefined;
    if (scenario !== "orientation" && scenario !== "targeted-read" && scenario !== "resume")
        return undefined;
    const corpus = plainRecord(root.corpus);
    if (!corpus || Reflect.ownKeys(corpus).some((key) => key !== "id" && key !== "version"))
        return undefined;
    const corpusId = canonicalToken(corpus.id, 64);
    const version = canonicalToken(corpus.version, 128);
    const expected = canonicalToken(root.expected_answer, 512);
    if (!corpusId || !ID_PATTERN.test(corpusId) || !version || !VERSION_PATTERN.test(version) || !expected || !ANSWER_PATTERN.test(expected))
        return undefined;
    if (typeof root.repeats !== "number" || !Number.isSafeInteger(root.repeats) || root.repeats < 1 || root.repeats > TASK_COST_MAX_REPEATS)
        return undefined;
    if (root.scenario === "targeted-read" && root.target_id === undefined)
        return undefined;
    const target = root.target_id === undefined ? undefined : canonicalToken(root.target_id, 64);
    if (root.target_id !== undefined && (!target || !ID_PATTERN.test(target)))
        return undefined;
    return {
        schema: TASK_COST_DECLARATION_SCHEMA,
        id,
        scenario,
        corpus: { id: corpusId, version },
        expected_answer: expected,
        repeats: root.repeats,
        ...(target === undefined ? {} : { target_id: target }),
    };
}
/**
 * Trim and turn CRLF into LF before a token is matched. This is the write-path normalizer.
 *
 * @param value - Untrusted string.
 * @param max - Maximum length after normalization.
 * @returns Normalized string, or undefined when the value is not a bounded string.
 */
export function canonicalToken(value, max) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
    if (normalized.length === 0 || normalized.length > max || normalized.includes("\n"))
        return undefined;
    return normalized;
}
/**
 * Parse a measurement request. Flat fields and a declaration array share this schema.
 *
 * @param input - Untrusted SDK or CLI payload.
 * @returns Canonical request pieces, or undefined.
 */
export function parseTaskCostRequest(input) {
    const root = plainRecord(input);
    if (!root)
        return undefined;
    const allowed = new Set(["mode", "scenario", "repeats", "corpus_id", "corpus_version", "expected_answer", "target_id", "id", "declarations"]);
    if (Reflect.ownKeys(root).some((key) => typeof key !== "string" || !allowed.has(key)))
        return undefined;
    const mode = root.mode === undefined ? "run" : root.mode;
    if (mode !== "declare" && mode !== "run" && mode !== "probe")
        return undefined;
    const scenario = root.scenario === undefined ? "orientation" : root.scenario;
    if (scenario !== "all" && scenario !== "orientation" && scenario !== "targeted-read" && scenario !== "resume")
        return undefined;
    const repeats = root.repeats === undefined ? 3 : root.repeats;
    if (typeof repeats !== "number" || !Number.isSafeInteger(repeats) || repeats < 1 || repeats > TASK_COST_MAX_REPEATS)
        return undefined;
    const corpusId = canonicalToken(root.corpus_id, 64);
    if (!corpusId || !ID_PATTERN.test(corpusId))
        return undefined;
    const corpusVersion = root.corpus_version === undefined ? undefined : canonicalToken(root.corpus_version, 128);
    if (root.corpus_version !== undefined && (!corpusVersion || !VERSION_PATTERN.test(corpusVersion)))
        return undefined;
    const expectedAnswer = root.expected_answer === undefined ? undefined : canonicalToken(root.expected_answer, 512);
    if (root.expected_answer !== undefined && (!expectedAnswer || !ANSWER_PATTERN.test(expectedAnswer)))
        return undefined;
    const targetId = root.target_id === undefined ? undefined : canonicalToken(root.target_id, 64);
    if (root.target_id !== undefined && (!targetId || !ID_PATTERN.test(targetId)))
        return undefined;
    const id = root.id === undefined ? undefined : canonicalToken(root.id, 64);
    if (root.id !== undefined && (!id || !ID_PATTERN.test(id)))
        return undefined;
    let declarations;
    if (root.declarations !== undefined) {
        if (!Array.isArray(root.declarations) || root.declarations.length < 1 || root.declarations.length > 3)
            return undefined;
        declarations = [];
        for (let index = 0; index < root.declarations.length; index += 1) {
            if (!Object.hasOwn(root.declarations, index))
                return undefined;
            const parsed = parseTaskCostDeclaration(root.declarations[index]);
            if (!parsed)
                return undefined;
            declarations.push(parsed);
        }
    }
    if (scenario === "all" && (mode === "run" || mode === "probe") && !Array.isArray(root.declarations))
        return undefined;
    if ((mode === "run" || mode === "probe") && scenario !== "all" && root.expected_answer === undefined && !Array.isArray(root.declarations))
        return undefined;
    if ((mode === "run" || mode === "probe") && root.corpus_version === undefined && !Array.isArray(root.declarations))
        return undefined;
    if (Array.isArray(root.declarations) && (root.expected_answer !== undefined || root.corpus_version !== undefined || root.target_id !== undefined))
        return undefined;
    return {
        mode,
        scenario,
        repeats,
        corpusId,
        ...(corpusVersion === undefined ? {} : { corpusVersion }),
        ...(expectedAnswer === undefined ? {} : { expectedAnswer }),
        ...(targetId === undefined ? {} : { targetId }),
        ...(id === undefined ? {} : { id }),
        ...(declarations === undefined ? {} : { declarations }),
    };
}
/**
 * Select the declaration rows a request will measure.
 *
 * @param request - Parsed request.
 * @param digest - Observed corpus digest.
 * @param firstId - First certified item id, used when declare omits a target.
 * @returns One declaration per scenario, with declare answers filled later.
 */
function requestDeclarations(request, digest, firstId) {
    if (request.declarations)
        return request.declarations;
    const version = request.corpusVersion ?? digest;
    const selected = request.scenario === "all" ? SCENARIOS : [request.scenario];
    return selected.map((scenario) => {
        const target = scenario === "targeted-read" ? request.targetId ?? firstId : undefined;
        if (scenario === "targeted-read" && target === undefined) {
            throw new TaskCostContractError("empty_tracker", "Create an item or pass --target-id before targeted-read.");
        }
        return {
            schema: TASK_COST_DECLARATION_SCHEMA,
            id: request.id ?? `baseline-${scenario}`,
            scenario,
            corpus: { id: request.corpusId, version },
            expected_answer: request.expectedAnswer ?? "orientation:active=0,blocked=0,done=0,canceled=0,terminal=0,focus=pending",
            repeats: request.repeats,
            ...(target === undefined ? {} : { target_id: target }),
        };
    });
}
/**
 * Measure fixed scenarios and check answers on both supported runtimes.
 * Corpus observation is excluded from the scenario call and byte budgets.
 *
 * @param host - Injected SDK client.
 * @param input - Strict request object.
 * @returns Compact report or a typed refusal.
 */
export async function runTaskCostBaselines(host, input) {
    const request = parseTaskCostRequest(input);
    if (!request) {
        return refuse("invalid_request", "Pass { mode?: 'declare'|'run'|'probe', scenario?: 'orientation'|'targeted-read'|'resume'|'all', corpus_id, repeats?: 1..8 } and, for run or probe, corpus_version plus expected_answer.", 2);
    }
    try {
        const corpus = await observeCorpus(host.client);
        if (request.corpusVersion?.startsWith("digest:") && request.corpusVersion !== corpus.digest) {
            return refuse("corpus_mismatch", "Re-declare the baseline; the corpus digest no longer matches corpus_version.");
        }
        const firstId = [...corpus.items].sort((left, right) => compareText(left.id, right.id))[0]?.id;
        const selected = requestDeclarations(request, corpus.digest, firstId);
        if (request.mode !== "declare") {
            for (const declaration of selected) {
                if (declaration.corpus.id !== request.corpusId || declaration.corpus.version !== (request.corpusVersion ?? declaration.corpus.version)) {
                    return refuse("corpus_mismatch", "Use one corpus id and version for every declaration in the request.");
                }
            }
        }
        if (selected.some((row) => row.corpus.id !== request.corpusId || row.corpus.version !== selected[0].corpus.version || (row.corpus.version.startsWith("digest:") && row.corpus.version !== corpus.digest)))
            return refuse("corpus_mismatch", "Re-declare on one unchanged corpus and use the same corpus identity and version in every declaration.");
        const remote = syntheticRemoteClient(host.client);
        const scenarios = [];
        let probe;
        for (const declaration of selected) {
            const directory = await repeatScenario(host.client, declaration.scenario, declaration.repeats, declaration.target_id, host, false);
            const synthetic = await repeatScenario(remote, declaration.scenario, declaration.repeats, declaration.target_id, host, false);
            if (directory.answer !== synthetic.answer) {
                return refuse("runtime_answer_mismatch", "Retry on a stable corpus; directory and synthetic-remote answers differed.");
            }
            const expected = request.mode === "declare" ? directory.answer : declaration.expected_answer;
            if (directory.answer !== expected) {
                return refuse("answer_mismatch", `Re-declare ${declaration.scenario}; expected ${expected} but observed a different answer token.`);
            }
            const shaped = distributions(directory.calls, directory.bytes, directory.elapsed);
            const cloned = distributions(synthetic.calls, synthetic.bytes, synthetic.elapsed);
            const row = {
                scenario: declaration.scenario,
                corpus: { id: declaration.corpus.id, version: declaration.corpus.version },
                expected_answer: expected,
                answer: directory.answer,
                answer_ok: true,
                identical_answer: true,
                tools: directory.tools,
                synthetic_remote: { calls: cloned.calls, delivered_bytes: cloned.delivered_bytes, elapsed_ns: cloned.elapsed_ns },
                calls: shaped.calls,
                delivered_bytes: shaped.delivered_bytes,
                elapsed_ns: shaped.elapsed_ns,
                elapsed_use: "display_only",
                estimate: shaped.estimate,
                ceil_estimate: { label: "estimate", method: "ceil(utf8_bytes / 4)", value: shaped.ceil },
                not_model_performance: true,
            };
            scenarios.push(row);
            if (request.mode === "probe" && probe === undefined) {
                const wastedDirectory = await repeatScenario(host.client, declaration.scenario, declaration.repeats, declaration.target_id, host, true);
                const wastedRemote = await repeatScenario(remote, declaration.scenario, declaration.repeats, declaration.target_id, host, true);
                if (wastedDirectory.answer !== directory.answer || wastedRemote.answer !== directory.answer) {
                    return refuse("runtime_answer_mismatch", "The extra full-list probe must not change the checked answer; retry on a stable corpus.");
                }
                const wasted = distributions(wastedDirectory.calls, wastedDirectory.bytes, wastedDirectory.elapsed);
                const cleanCalls = shaped.calls.median;
                const cleanBytes = shaped.delivered_bytes.median;
                const wastedCalls = wasted.calls.median;
                const wastedBytes = wasted.delivered_bytes.median;
                if (!budgetWorsened(cleanCalls, cleanBytes, wastedCalls, wastedBytes)) {
                    return refuse("budget_not_worsened", "The extra full-list call did not increase both budgets; inspect the meter before trusting this host.");
                }
                probe = {
                    injected: "listAllComplete",
                    worsened: true,
                    clean_calls: cleanCalls,
                    wasted_calls: wastedCalls,
                    clean_bytes: cleanBytes,
                    wasted_bytes: wastedBytes,
                    delta_calls: subtractRationals(wastedCalls, cleanCalls),
                    delta_bytes: subtractRationals(wastedBytes, cleanBytes),
                };
            }
        }
        const finalCorpus = await observeCorpus(host.client);
        if (finalCorpus.digest !== corpus.digest)
            return refuse("corpus_mismatch", "Retry on an unchanged corpus; tracker state changed during measurement.");
        const report = {
            ok: true,
            schema: TASK_COST_REPORT_SCHEMA,
            mode: request.mode,
            not_model_performance: true,
            process_calls: 0,
            process_scope: "package_spawned_children",
            runtime: taskCostRuntime(process.versions),
            declarations: scenarios.map((row, index) => ({ ...selected[index], corpus: row.corpus, expected_answer: row.expected_answer })),
            corpus: { id: request.corpusId, version: selected[0].corpus.version, observed_digest: corpus.digest, item_count: corpus.items.length },
            corpus_observation: { calls: 2, delivered_bytes: corpus.bytes + finalCorpus.bytes, excluded_from_scenario_budget: true },
            scenarios,
            ...(probe === undefined ? {} : { probe }),
        };
        return assertTaskCostReport(report);
    }
    catch (error) {
        if (error instanceof TaskCostContractError)
            return refuse(error.code, error.message);
        return refuse("source_unavailable", "Retry against a readable initialized tracker. A failed certified read cannot prove a baseline.");
    }
}
/**
 * Map CLI options onto the strict request. Host renderer flags are ignored, not rejected.
 *
 * @param options - Command options from the host.
 * @returns Strict request object.
 */
export function taskCostRequestFromOptions(options) {
    const request = {};
    if (Object.hasOwn(options, "declarations")) {
        try {
            request.declarations = typeof options.declarations === "string" ? JSON.parse(options.declarations) : options.declarations;
        }
        catch {
            request.declarations = null;
        }
    }
    if (Object.hasOwn(options, "mode"))
        request.mode = options.mode;
    if (Object.hasOwn(options, "scenario"))
        request.scenario = options.scenario;
    if (Object.hasOwn(options, "repeats"))
        request.repeats = typeof options.repeats === "string" && /^[0-9]+$/u.test(options.repeats) ? Number(options.repeats) : options.repeats;
    if (Object.hasOwn(options, "corpus-id") || Object.hasOwn(options, "corpusId"))
        request.corpus_id = Object.hasOwn(options, "corpus-id") ? options["corpus-id"] : options.corpusId;
    if (Object.hasOwn(options, "corpus-version") || Object.hasOwn(options, "corpusVersion"))
        request.corpus_version = Object.hasOwn(options, "corpus-version") ? options["corpus-version"] : options.corpusVersion;
    if (Object.hasOwn(options, "expected-answer") || Object.hasOwn(options, "expectedAnswer"))
        request.expected_answer = Object.hasOwn(options, "expected-answer") ? options["expected-answer"] : options.expectedAnswer;
    if (Object.hasOwn(options, "target-id") || Object.hasOwn(options, "targetId"))
        request.target_id = Object.hasOwn(options, "target-id") ? options["target-id"] : options.targetId;
    if (Object.hasOwn(options, "id"))
        request.id = options.id;
    return request;
}
/**
 * Run the baseline command from the host-injected SDK only.
 *
 * @param ctx - Extension command context. `ctx.sdk` is required.
 * @returns The same result the SDK function returns.
 */
export async function runTaskCostCommand(ctx) {
    const sdk = ctx.sdk;
    if (!sdk)
        return refuse("sdk_unavailable", "Use a pm host that injects ctx.sdk (pm-cli >=2026.10.23).", 2);
    const host = { client: sdk.client, isItemNotFoundError: (error) => sdk.isItemNotFoundError(error) };
    return runTaskCostBaselines(host, taskCostRequestFromOptions(ctx.options));
}
//# sourceMappingURL=baselines.js.map
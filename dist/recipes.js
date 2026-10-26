const RECIPES = ["missing-item", "unsupported-capability", "insufficient-budget"];
/** One strict boundary schema: a plain object with only an optional, bounded enum selector. */
export function parseFailureFirstRequest(input) {
    try {
        if (input === null || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype)
            return undefined;
        const keys = Reflect.ownKeys(input);
        if (keys.some((key) => key !== "recipe"))
            return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(input, "recipe");
        if (!descriptor)
            return {};
        if (!("value" in descriptor))
            return undefined;
        const recipe = descriptor.value;
        if (recipe !== "all" && recipe !== "missing-item" && recipe !== "unsupported-capability" && recipe !== "insufficient-budget")
            return undefined;
        return { recipe };
    }
    catch {
        return undefined;
    }
}
/** Narrow producer-owned records without reading error messages or accepting arrays. */
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
/** Accept only dense, bounded native enum arrays containing the safe read we intend to perform. */
function allowsAncestors(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64)
        return false;
    for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index) || typeof value[index] !== "string" || !/^[a-z-]{1,32}$/.test(value[index]))
            return false;
    }
    return value.includes("ancestors");
}
/** An absent native recovery contract is distinct from an unreadable source. */
export class FailureFirstContractError extends Error {
    constructor() { super("Require the documented native recovery contract and retry with a compatible host."); }
}
/** Validate every emitted number before constructing a successful receipt. */
export function failureFirstItemCount(source) {
    const count = source.complete_list.item_count;
    if (!Number.isSafeInteger(count) || count < 0 || count !== source.items.length)
        throw new FailureFirstContractError();
    return count;
}
/** Require the native classifier plus opaque structured guidance, without parsing its prose. */
export function assertMissingItemRecovery(error, classified) {
    const context = record(record(error).context);
    if (!classified || !Array.isArray(context.nextSteps) || context.nextSteps.length === 0)
        throw new FailureFirstContractError();
}
/** Choose the safe read only when the native refusal advertises it in its complete legal domain. */
export function assertUnsupportedCapabilityRecovery(error) {
    const context = record(record(error).context);
    if (context.code !== "unknown_subcommand" || !allowsAncestors(record(context.recovery).allowed_values))
        throw new FailureFirstContractError();
}
/** Admit only the native budget remedy that the canonical complete-list API implements. */
export function assertInsufficientBudgetRecovery(value) {
    const omitted = record(record(value).output_budget_exceeded);
    if (omitted.omitted_result !== true || omitted.reason !== "requested_budget_infeasible"
        || record(omitted.recovery).outputBudget !== "unbounded")
        throw new FailureFirstContractError();
}
/** Observe a native read failure without translating its producer-owned payload or inspecting prose. */
export async function captureReadRefusal(read) {
    try {
        await read();
        return undefined;
    }
    catch (error) {
        return error;
    }
}
/** Build constant, secret-free refusal output. */
function refused(code, remediation, exit_code = 1) {
    return { ok: false, exit_code, code, remediation };
}
/**
 * Complete bounded native recovery loops against the supplied tracker, without durable writes.
 * Each retry is an allowlisted SDK read; advertised shell strings are never executed.
 * Counts describe the initial certified read, not an atomic snapshot across separate reads.
 */
export async function runFailureFirstRecipes(host, input = {}) {
    const request = parseFailureFirstRequest(input);
    if (!request)
        return refused("invalid_request", "Use { recipe?: 'all' | 'missing-item' | 'unsupported-capability' | 'insufficient-budget' }.", 2);
    try {
        const source = await host.client.listAllComplete();
        const count = failureFirstItemCount(source);
        if (count === 0)
            return refused("empty_tracker", "Select a readable tracker containing at least one item; recipes never create fixtures for you.");
        const id = source.items[0].id;
        const ids = new Set(source.items.map((item) => item.id));
        let missing = id;
        while (ids.has(missing))
            missing += "x";
        const receipts = [];
        const selected = request.recipe === undefined || request.recipe === "all" ? RECIPES : [request.recipe];
        for (const recipe of selected) {
            if (recipe === "missing-item") {
                const error = await captureReadRefusal(() => host.client.get(missing));
                // Older SDKs expose this refusal via the host classifier, not a context.code field.
                // nextSteps is guidance only: discover current identity through a certified SDK read.
                assertMissingItemRecovery(error, host.isItemNotFoundError(error));
                const current = await host.client.listAllComplete();
                if (current.items.length === 0)
                    return refused("empty_tracker", "Select a tracker with an existing item, then retry discovery.");
                const discovered = current.items[0].id;
                await host.client.get(discovered);
                receipts.push({ recipe, code: "item_not_found", code_source: "sdk_classifier", remedy: "discover_existing_id", retry: "client.get(discoveredId)", recovered: true });
            }
            else if (recipe === "unsupported-capability") {
                const error = await captureReadRefusal(() => host.client.run("graph", { options: { subcommand: "unsupported" } }));
                assertUnsupportedCapabilityRecovery(error);
                // Select a read from the native legal domain; never execute 'index' or a suggested shell command.
                await host.client.graph("ancestors", { id });
                receipts.push({ recipe, code: "unknown_subcommand", code_source: "native_payload", remedy: "choose_allowed_read", retry: "client.graph('ancestors', { id })", recovered: true });
            }
            else {
                const attempted = await host.client.list({ status: "all", outputBudget: 1 });
                assertInsufficientBudgetRecovery(attempted);
                // listAllComplete owns the strict, unbounded invocation prescribed by this native remedy.
                await host.client.listAllComplete();
                receipts.push({ recipe, code: "requested_budget_infeasible", code_source: "native_payload", remedy: "use_advertised_budget", retry: "client.listAllComplete()", recovered: true });
            }
        }
        return { ok: true, schema: "pm-starter/failure-first/v1", item_count: count, recipes: receipts };
    }
    catch (error) {
        if (error instanceof FailureFirstContractError)
            return refused("recovery_contract_unavailable", error.message);
        return refused("source_unavailable", "Use a readable initialized tracker and retry; a concurrent change or failed read cannot prove recovery.");
    }
}
/** Run the same public recipe API with the host-bound SDK and one CLI selector. */
export async function runFailureFirstCommand(ctx) {
    const input = Object.hasOwn(ctx.options, "recipe") ? { recipe: ctx.options.recipe } : {};
    if (!ctx.sdk)
        return refused("sdk_unavailable", "Use a pm host that injects ctx.sdk (pm-cli >=2026.10.20).", 2);
    return runFailureFirstRecipes(ctx.sdk, input);
}
//# sourceMappingURL=recipes.js.map
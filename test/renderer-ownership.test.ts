import assert from "node:assert/strict";
import test from "node:test";

import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import type { RendererOverrideContext } from "@unbrained/pm-cli/sdk/authoring";

import extension from "../index.ts";

/** Manifest capabilities the harness must grant for registration to be permitted. */
const CAPABILITIES = ["commands", "renderers", "hooks", "schema", "importers", "search", "parser", "preflight", "services"] as const;

/**
 * Command path whose result pm-starter's renderer is meant to render.
 *
 * Derived from the `api.registerCommand({ name })` call in `index.ts` — only
 * the `starter demo` command emits a `starter_demo: true` marker.
 */
const OWNED_COMMANDS = ["starter demo"];

async function harness() {
  return createExtensionTestHarness(extension, { name: "pm-starter", capabilities: CAPABILITIES });
}

/** A result carrying pm-starter's private demo marker, as the command emits. */
const markedResult = { starter_demo: true, item_count: 2, sample: [{ id: "pm-1", status: "open", title: "T" }] } as unknown;

/** A foreign result no pm-starter command would ever produce. */
const foreignResult = { pmChangelogRendered: true, output: "{}\n" } as unknown;

/** A bare result carrying pm-starter's output shape but no demo marker. */
const bareResult = { output: "x" } as unknown;

/** A command path pm-starter does not own, used to exercise the command filter. */
const foreignCommand = "changelog generate";

test("renderer ownership is registered for both toon and json formats with the package's commands", async () => {
  const ext = await harness();
  const overrides = ext.activation.renderers.overrides;
  assert.deepEqual(
    overrides.map((override) => ({ format: override.format, commands: override.commands })),
    [
      { format: "json", commands: OWNED_COMMANDS },
      { format: "toon", commands: OWNED_COMMANDS },
    ],
  );
  for (const override of overrides) {
    assert.equal(typeof override.resultDiscriminator, "function", "resultDiscriminator must be present");
  }
  await ext.deactivate();
});

test("json renderer renders its own marked result", async () => {
  const ext = await harness();
  const context: RendererOverrideContext = { format: "json", command: "starter demo", result: markedResult };
  const rendered = await ext.runRendererOverride(context);
  assert.equal(rendered.overridden, true, "json renderer should claim a marked result");
  const parsed = JSON.parse(rendered.rendered ?? "null") as { rendered_by?: string; starter_demo?: boolean };
  assert.equal(parsed.rendered_by, "pm-starter", "json renderer should tag its output");
  assert.equal(parsed.starter_demo, true, "json renderer should preserve the marker");
  assert.deepEqual(rendered.warnings, [], "json render should produce no warnings");
  await ext.deactivate();
});

test("toon renderer renders its own marked result as a compact line view", async () => {
  const ext = await harness();
  const context: RendererOverrideContext = { format: "toon", command: "starter demo", result: markedResult };
  const rendered = await ext.runRendererOverride(context);
  assert.equal(rendered.overridden, true, "toon renderer should claim a marked result");
  assert.match(rendered.rendered ?? "", /^pm-starter demo — 2 item\(s\)/, "toon renderer should produce the compact header");
  assert.deepEqual(rendered.warnings, [], "toon render should produce no warnings");
  await ext.deactivate();
});

test("declines a foreign result on an owned command (resultDiscriminator rejects after commands match)", async () => {
  const ext = await harness();
  // The command is the one pm-starter owns, so the commands filter passes; the
  // result must be rejected by resultDiscriminator alone. Exercises the
  // discriminator after commands has already matched.
  for (const format of ["toon", "json"] as const) {
    for (const result of [foreignResult, bareResult]) {
      const context: RendererOverrideContext = { format, command: "starter demo", result };
      const rendered = await ext.runRendererOverride(context);
      assert.equal(rendered.overridden, false, `${format} renderer should decline a foreign/bare result on an owned command`);
      assert.equal(rendered.rendered, null, `${format} should leave native rendering intact`);
      assert.deepEqual(rendered.warnings, [], `${format} should produce no warnings`);
    }
  }
  await ext.deactivate();
});

test("declines its own marked result on a foreign command (commands ownership rejects)", async () => {
  const ext = await harness();
  // The result carries pm-starter's marker so resultDiscriminator would accept
  // it, but the command is one pm-starter does not own. The host's commands
  // filter must decline before the renderer runs. This is the case that
  // protects the ownership boundary the PR introduces: it fails if the commands
  // declaration is dropped, because then resultDiscriminator alone would let
  // the renderer claim a marked result emitted under a foreign command path.
  for (const format of ["toon", "json"] as const) {
    const context: RendererOverrideContext = { format, command: foreignCommand, result: markedResult };
    const rendered = await ext.runRendererOverride(context);
    assert.equal(rendered.overridden, false, `${format} renderer should decline its own marked result on a foreign command`);
    assert.equal(rendered.rendered, null, `${format} should leave native rendering intact`);
    assert.deepEqual(rendered.warnings, [], `${format} should produce no warnings`);
  }
  await ext.deactivate();
});

test("declines when both command and result are foreign (belt-and-braces)", async () => {
  const ext = await harness();
  for (const format of ["toon", "json"] as const) {
    const context: RendererOverrideContext = { format, command: foreignCommand, result: foreignResult };
    const rendered = await ext.runRendererOverride(context);
    assert.equal(rendered.overridden, false, `${format} renderer should decline a foreign result under a foreign command`);
    assert.equal(rendered.rendered, null, `${format} should leave native rendering intact`);
    assert.deepEqual(rendered.warnings, [], `${format} should produce no warnings`);
  }
  await ext.deactivate();
});

test("registered resultDiscriminator accepts the package marker and rejects a foreign marker", async () => {
  const ext = await harness();
  for (const override of ext.activation.renderers.overrides) {
    assert.equal(override.resultDiscriminator?.(markedResult), true, "discriminator must accept its own marker");
    assert.equal(override.resultDiscriminator?.(foreignResult), false, "discriminator must reject a foreign marker");
    assert.equal(override.resultDiscriminator?.({ output: "x" }), false, "discriminator must reject a bare object");
    assert.equal(override.resultDiscriminator?.({ starter_demo: false }), false, "discriminator must reject a false marker");
  }
  await ext.deactivate();
});
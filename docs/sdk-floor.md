# Published pm SDK capability floor

Audited main: `af1722d8414ddeb016fc8a4e8a91732c1ca04f9f`. Required API floor: **2026.8.18**.

Previous main host floor: `2026.8.15`. Previous npm peer: `>=2026.8.15`.

This change raises the host and npm peer declarations to `2026.8.18`. The exact development SDK pin is `2026.10.23`; this additive baseline audit does not change it.

## Artifact method and limits

The published version list was obtained with `npm view @unbrained/pm-cli versions --json`. Each capability was bisected over stable published releases, with its first providing release and adjacent previous stable release inspected. Prereleases do not satisfy these stable npm minimum ranges. Tarballs were downloaded with `npm pack @unbrained/pm-cli@VERSION --ignore-scripts` into an isolated scratch directory and inspected as data. No downloaded pm package code or lifecycle script was executed.

Public module exports were checked against both `package.json` entrypoints and the static ESM runtime export graph, then their `dist` declarations. Client methods and context members were read from the published declarations, including inherited members and static methods. A context property is attributed to the context used by this package, rather than a later base-interface refactor. TypeScript symbol resolution covers aliases, typed lazy loaders, destructuring, and clients passed through helpers. Erased interfaces do not create runtime requirements; imported function/constructor types used by loaders are retained conservatively.

This establishes API availability. It does not attest older-host runtime semantics, provider integration, or execution on the declared minimum. The current pinned SDK remains the local test host.

## API to first-version table

The machine-readable source inventory and artifact hashes are in [sdk-floor.json](sdk-floor.json). Source locations refer to the audited main commit.

| Used API | First stable release | Previous stable release lacking it | Source uses |
| --- | --- | --- | --- |
| `@unbrained/pm-cli/sdk :: PmClient` | 2026.7.6 | 2026.7.5 | [laboratories.ts:3](../laboratories.ts#L3), [recipes.ts:2](../recipes.ts#L2) |
| `AfterCommandHookContext.error` | 2026.5.1 | 2026.3.12 | [index.ts:830](../index.ts#L830) |
| `AfterCommandHookContext.ok` | 2026.5.1 | 2026.3.12 | [index.ts:830](../index.ts#L830) |
| `BeforeCommandHookContext.args` | 2026.5.1 | 2026.3.12 | [index.ts:825](../index.ts#L825) |
| `BeforeCommandHookContext.command` | 2026.5.1 | 2026.3.12 | [index.ts:825](../index.ts#L825), [index.ts:830](../index.ts#L830) |
| `CommandHandlerContext.args` | 2026.5.1 | 2026.3.12 | [index.ts:441](../index.ts#L441), [index.ts:585](../index.ts#L585), [index.ts:1044](../index.ts#L1044) |
| `CommandHandlerContext.command` | 2026.5.1 | 2026.3.12 | [index.ts:1073](../index.ts#L1073) |
| `CommandHandlerContext.options` | 2026.5.1 | 2026.3.12 | [laboratories.ts:125](../laboratories.ts#L125), [laboratories.ts:126](../laboratories.ts#L126), [laboratories.ts:145](../laboratories.ts#L145), [recipes.ts:164](../recipes.ts#L164), [index.ts:321](../index.ts#L321), [index.ts:322](../index.ts#L322), [index.ts:323](../index.ts#L323), [index.ts:383](../index.ts#L383), [index.ts:441](../index.ts#L441), [index.ts:484](../index.ts#L484), [index.ts:516](../index.ts#L516), [index.ts:595](../index.ts#L595), [index.ts:596](../index.ts#L596), [index.ts:660](../index.ts#L660), [index.ts:661](../index.ts#L661), [index.ts:662](../index.ts#L662), [index.ts:1044](../index.ts#L1044) |
| `CommandHandlerContext.pm_root` | 2026.5.1 | 2026.3.12 | [index.ts:348](../index.ts#L348), [index.ts:453](../index.ts#L453), [index.ts:517](../index.ts#L517), [index.ts:597](../index.ts#L597) |
| `CommandHandlerContext.sdk` | 2026.7.19 | 2026.7.18 | [laboratories.ts:131](../laboratories.ts#L131), [laboratories.ts:135](../laboratories.ts#L135), [recipes.ts:165](../recipes.ts#L165), [recipes.ts:166](../recipes.ts#L166), [index.ts:240](../index.ts#L240), [index.ts:242](../index.ts#L242), [index.ts:244](../index.ts#L244) |
| `ExtensionApi.hooks` | 2026.5.1 | 2026.3.12 | [index.ts:824](../index.ts#L824), [index.ts:829](../index.ts#L829), [index.ts:834](../index.ts#L834), [index.ts:839](../index.ts#L839), [index.ts:844](../index.ts#L844) |
| `ExtensionApi.registerCommand` | 2026.5.1 | 2026.3.12 | [index.ts:284](../index.ts#L284), [index.ts:292](../index.ts#L292), [index.ts:306](../index.ts#L306), [index.ts:335](../index.ts#L335), [index.ts:396](../index.ts#L396), [index.ts:420](../index.ts#L420), [index.ts:499](../index.ts#L499), [index.ts:562](../index.ts#L562), [index.ts:641](../index.ts#L641) |
| `ExtensionApi.registerExporter` | 2026.5.1 | 2026.3.12 | [index.ts:922](../index.ts#L922), [index.ts:938](../index.ts#L938) |
| `ExtensionApi.registerFlags` | 2026.5.1 | 2026.3.12 | [index.ts:1137](../index.ts#L1137) |
| `ExtensionApi.registerImporter` | 2026.5.1 | 2026.3.12 | [index.ts:926](../index.ts#L926) |
| `ExtensionApi.registerItemFields` | 2026.5.1 | 2026.3.12 | [index.ts:870](../index.ts#L870) |
| `ExtensionApi.registerItemTypes` | 2026.5.1 | 2026.3.12 | [index.ts:877](../index.ts#L877) |
| `ExtensionApi.registerMigration` | 2026.5.1 | 2026.3.12 | [index.ts:889](../index.ts#L889) |
| `ExtensionApi.registerParser` | 2026.5.1 | 2026.3.12 | [index.ts:1041](../index.ts#L1041) |
| `ExtensionApi.registerPreflight` | 2026.5.1 | 2026.3.12 | [index.ts:1068](../index.ts#L1068) |
| `ExtensionApi.registerRenderer` | 2026.5.1 | 2026.3.12 | [index.ts:778](../index.ts#L778), [index.ts:788](../index.ts#L788) |
| `ExtensionApi.registerSearchProvider` | 2026.5.1 | 2026.3.12 | [index.ts:968](../index.ts#L968) |
| `ExtensionApi.registerService` | 2026.5.1 | 2026.3.12 | [index.ts:1115](../index.ts#L1115) |
| `ExtensionApi.registerVectorStoreAdapter` | 2026.5.1 | 2026.3.12 | [index.ts:996](../index.ts#L996) |
| `ExtensionCommandSdk.client` | 2026.7.19 | 2026.7.18 | [laboratories.ts:135](../laboratories.ts#L135), [index.ts:242](../index.ts#L242), [index.ts:244](../index.ts#L244) |
| `ImportExportContext.options` | 2026.5.1 | 2026.3.12 | [index.ts:927](../index.ts#L927) |
| `OnIndexHookContext.mode` | 2026.5.1 | 2026.3.12 | [index.ts:845](../index.ts#L845) |
| `OnIndexHookContext.total_items` | 2026.5.1 | 2026.3.12 | [index.ts:845](../index.ts#L845) |
| `OnReadHookContext.path` | 2026.5.1 | 2026.3.12 | [index.ts:840](../index.ts#L840) |
| `OnWriteHookContext.op` | 2026.5.1 | 2026.3.12 | [index.ts:835](../index.ts#L835) |
| `OnWriteHookContext.path` | 2026.5.1 | 2026.3.12 | [index.ts:835](../index.ts#L835) |
| `OnWriteHookContext.scope` | 2026.5.1 | 2026.3.12 | [index.ts:835](../index.ts#L835) |
| `PmClient.get` | 2026.7.6 | 2026.7.5 | [recipes.ts:132](../recipes.ts#L132), [recipes.ts:139](../recipes.ts#L139) |
| `PmClient.graph` | 2026.7.18 | 2026.7.17 | [recipes.ts:145](../recipes.ts#L145) |
| `PmClient.list` | 2026.7.6 | 2026.7.5 | [recipes.ts:148](../recipes.ts#L148) |
| `PmClient.listAllComplete` | 2026.8.18 | 2026.8.17 | [laboratories.ts:51](../laboratories.ts#L51), [laboratories.ts:56](../laboratories.ts#L56), [recipes.ts:121](../recipes.ts#L121), [recipes.ts:136](../recipes.ts#L136), [recipes.ts:151](../recipes.ts#L151), [index.ts:242](../index.ts#L242) |
| `PmClient.run` | 2026.7.6 | 2026.7.5 | [recipes.ts:142](../recipes.ts#L142), [index.ts:244](../index.ts#L244) |
| `PreflightOverrideContext.decision` | 2026.5.1 | 2026.3.12 | [index.ts:1069](../index.ts#L1069) |
| `RendererOverrideContext.result` | 2026.5.1 | 2026.3.12 | [index.ts:779](../index.ts#L779), [index.ts:789](../index.ts#L789) |
| `SearchProviderQueryContext.documents` | 2026.5.1 | 2026.3.12 | [index.ts:976](../index.ts#L976) |
| `SearchProviderQueryContext.query` | 2026.5.1 | 2026.3.12 | [index.ts:971](../index.ts#L971) |
| `VectorStoreQueryContext.limit` | 2026.5.1 | 2026.3.12 | [index.ts:1016](../index.ts#L1016) |

## Agent task baseline additions

The baseline extension adds three source-derived API entries. Its client surface
uses `Pick<PmClient, ...>` so the inventory resolves native methods through the
consumer boundary. Published declarations were inspected as inert archive data,
with an adjacent negative release for every added API. These releases all precede
the existing 2026.8.18 API floor, so host and npm peer declarations remain valid.
The new source locations below refer to the baseline feature; earlier locations
refer to the original audited main commit. The baseline's orient-intent protocol
has its separately documented 2026.10.23 semantic requirement and typed refusal.

| Added API | First stable release | Previous stable release lacking it | Source uses |
| --- | --- | --- | --- |
| `PmClient.context` | 2026.7.6 | 2026.7.5 | [baselines.ts:622](../baselines.ts#L622) |
| `PmClient.schemaList` | 2026.7.9 | 2026.7.8 | [baselines.ts:605](../baselines.ts#L605) |
| `ExtensionCommandSdk.isItemNotFoundError` | 2026.7.24 | 2026.7.23 | [baselines.ts:1164](../baselines.ts#L1164) |

## Tarball provenance

SHA-256 of the exact packed `.tgz` bytes; package archives and extracted files are not committed.

| pm release | Tarball SHA-256 |
| --- | --- |
| 2026.3.12 | `4e4e6a33cb45d665f072120e9e1ce25d2e5773e738cbc914b29e8f54367747fb` |
| 2026.5.1 | `730de8b79aa0074dc2ca81a54ce37f9aaa0a4167b690c9a62b87d2121a8b37f7` |
| 2026.7.5 | `4a6664f68120cace5648faf48d51b08c14e969d9c7e185e592f1a0fceae57274` |
| 2026.7.6 | `0d6e446cf93a0f0660ce4e21943adf1e0c21381010ef67369f40cc9834b8d158` |
| 2026.7.17 | `79f28898694458f61b73ccef7c4f2438d83b4aea49ea30cf972ca39a03aa84f4` |
| 2026.7.18 | `44b48fe680cf330254a4ab8d42b55cbcee81ba5cf21e4d4550b40413265d64b9` |
| 2026.7.19 | `513e0aead42767a113a26b8b2e2cbb8a22879d0cb0500d4d3cdd16d21d9f7a39` |
| 2026.8.17 | `fda330eb4887031751889ef85b510d52886fa5f70b4813f3951d7eed705023f2` |
| 2026.8.18 | `b00374f0e32c98ccec03a5893d8bfbbae45650f44bd04292ceafd8d9aac059f7` |

Additional baseline audit archives:

| pm release | Tarball SHA-256 |
| --- | --- |
| 2026.7.8 | `b892cce02e555decd3f0d09af0d2a5d8817494fe577e357ffaea84ef385a9b6a` |
| 2026.7.9 | `87600f77a82d5e66c8ac05f120b435a0fb22b5fad42ae5db4540bb4ca45a01ea` |
| 2026.7.23 | `caf1a21b0b587dc55c3509654466dd1e20383e30f2d17b47678887a15a5490af` |
| 2026.7.24 | `ae7757c7e4b02bf5c0908a7bcfd487926912bc2f71332c68c9e1be4017d796ab` |

The regression in `test/sdk-floor.test.ts` resolves current runtime source symbols and requires exact agreement with the committed table. A new SDK API without an evidence row fails; adding a newer row without raising both declarations also fails. It runs with the existing test glob in the CI npm and Bun release gates.

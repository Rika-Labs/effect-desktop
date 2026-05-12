# Layer-First Issue Order

This is the working order for all currently open roadmap issues as of the Layer-first planning pass. The order optimizes for one invariant: every effectful dependency should be supplied by an Effect `Layer`, every public capability should have a test substitute, and provider choice should not change user app code.

## Ordering Rules

1. Establish the Layer-first contract before refactoring individual surfaces.
2. Lock public API and RPC boundaries before adding provider breadth.
3. Make core runtime lifecycles substitutable before improving renderer ergonomics.
4. Prove provider switchability with contract tests before optimizing size and rebuilds.
5. Leave durable/distributed/product polish until the local Layer graph is stable.

## Ordered Issues

| Order | Issue                                                           | Why here                                                            |
| ----: | --------------------------------------------------------------- | ------------------------------------------------------------------- |
|     1 | #1227 Codify the Layer-first framework contract                 | Governs every following ticket.                                     |
|     2 | #1228 Enforce Layer-first API checks                            | Turns the contract into CI pressure.                                |
|     3 | #1229 Introduce the Desktop runtime layer graph                 | Creates the composition root that makes switching possible.         |
|     4 | #1205 Fix the React API subpath export                          | Removes a public API bug before surface work builds on it.          |
|     5 | #1178 Narrow the core public root export                        | Makes the core root expose stable Effect-native concepts.           |
|     6 | #1219 Narrow the native public root export                      | Prevents native implementation files from becoming SDK contract.    |
|     7 | #1154 Make RpcGroup the only renderer contract                  | Locks the renderer-callable boundary.                               |
|     8 | #1233 Make generated RPC surfaces Layer-first                   | Extends `RpcGroup` into server/client/test layers.                  |
|     9 | #1193 Generate desktop surfaces from Effect RpcGroup            | Applies the Layer-first RPC generator to desktop surfaces.          |
|    10 | #1179 Generate supported native client surfaces                 | Makes native clients generated and consistent.                      |
|    11 | #1194 Expose native capability facts as data                    | Gives provider and permission decisions typed facts.                |
|    12 | #1177 Remove generated @effect/cluster dependency               | Keeps phase-0 generated surfaces from pulling cluster prematurely.  |
|    13 | #1184 Use Effect serialization for host protocol frames         | Locks wire encoding before more surfaces depend on it.              |
|    14 | #1161 Shape framed transport as Effect socket stream            | Makes transport an Effect primitive boundary.                       |
|    15 | #1182 Rebase bridge stream state on Effect primitives           | Aligns stream state with the transport substrate.                   |
|    16 | #1155 Move bridge cancellation to Effect interruption           | Makes cancellation part of Effect semantics.                        |
|    17 | #1166 Use RpcTest for demo RPC transports                       | Gives early RPC surfaces a real test substitute.                    |
|    18 | #1220 Centralize release target modeling                        | Normalizes target data before provider/build work.                  |
|    19 | #1221 Centralize CSP and nonce policy                           | Removes duplicated security policy before more engines land.        |
|    20 | #1213 Add Bun and Node runtime providers                        | First runtime-provider proof of the Layer graph.                    |
|    21 | #1214 Prove runtime provider parity                             | Contract-tests Bun and Node against the same app behavior.          |
|    22 | #1230 Require Live Test and Client layers                       | Makes every capability expose the same substitution shape.          |
|    23 | #1232 Add capability contract test suites                       | Proves layers obey the same observable behavior.                    |
|    24 | #1231 Add a provider registry for swappable adapters            | Central registry for runtime, WebView, storage, and host providers. |
|    25 | #1156 Rebase resource registry on scoped ownership              | Core lifetime ownership before resource-heavy features.             |
|    26 | #1195 Model desktop resources with Scope and RcMap              | Applies scoped ownership to desktop resources.                      |
|    27 | #1163 Preserve approval failures as Effect results              | Keeps permission failures typed in the error channel.               |
|    28 | #1196 Run permissions as RPC middleware                         | Moves permission policy into the RPC boundary.                      |
|    29 | #1186 Encode approval actors with Schema                        | Gives approval participants stable wire/data shape.                 |
|    30 | #1190 Own approval prompt loops with FiberMap                   | Supervises approval fibers with Effect primitives.                  |
|    31 | #1188 Model secrets with Redacted values                        | Protects secrets before broader diagnostics and test layers.        |
|    32 | #1165 Decode desktop config with Schema                         | Establishes schema decode for app config.                           |
|    33 | #1174 Merge typed config after Schema decoding                  | Keeps config merging after validation.                              |
|    34 | #1185 Persist settings through schema codecs                    | Makes persisted settings compatibility explicit.                    |
|    35 | #1197 Add schema-coded desktop settings                         | Builds settings APIs on schema-coded data.                          |
|    36 | #1180 Use Effect Clock for runtime time                         | Removes hidden time dependency.                                     |
|    37 | #1181 Use Effect Random for runtime identifiers                 | Removes hidden randomness dependency.                               |
|    38 | #1158 Use Effect child process primitives                       | Replaces raw process APIs with Effect process.                      |
|    39 | #1159 Own process exit fibers with scopes                       | Gives process exit fibers owners.                                   |
|    40 | #1171 Enforce process budgets with semaphores                   | Adds bounded process concurrency.                                   |
|    41 | #1200 Expose local execution through Effect process and workers | Public local execution follows Effect primitives.                   |
|    42 | #1160 Replace worker adapter with Effect workers                | Moves worker capability to Effect workers.                          |
|    43 | #1172 Enforce worker budgets with semaphores                    | Adds bounded worker concurrency.                                    |
|    44 | #1189 Model worker events as scoped streams                     | Gives worker events scoped stream semantics.                        |
|    45 | #1183 Gate PTY concurrency with semaphores                      | Adds bounded PTY concurrency.                                       |
|    46 | #1222 Rebase native app events on Effect PubSub                 | Replaces manual event fanout with Effect state/fanout primitives.   |
|    47 | #1209 Drive Vite dev runtime with Effect process and socket     | Aligns dev runtime lifecycle with the process/socket substrate.     |
|    48 | #1215 Manage sidecar startup with Effect                        | Applies scoped startup reliability to sidecars.                     |
|    49 | #1234 Make provider layers lazy and tree-shakeable              | Keeps swappability from making defaults large.                      |
|    50 | #1235 Add Layer graph diagnostics                               | Makes selected layers and provider failures observable.             |
|    51 | #1216 Add selectable WebView providers                          | Adds WebView provider choice after registry and diagnostics.        |
|    52 | #1218 Split dev rebuilds by provider                            | Uses provider graph to rebuild less.                                |
|    53 | #1217 Measure provider size and startup budgets                 | Turns fast/small into provider-level budgets.                       |
|    54 | #1198 Provide desktop test layers                               | Public test layers become first-class user API.                     |
|    55 | #1223 Split test fixtures into public subpaths                  | Organizes test layers into stable SDK entry points.                 |
|    56 | #1225 Make doctor diagnostics data-first                        | Doctor reads typed facts from providers and layers.                 |
|    57 | #1226 Remove playground assumptions from release gates          | Release checks target configured subjects, not the demo app.        |
|    58 | #1224 Decompose the native updater crate                        | Makes update policy/staging auditable before release expansion.     |
|    59 | #1206 Run framework effects through ManagedRuntime              | Centralizes imperative framework edges.                             |
|    60 | #1207 Share renderer endpoint binding across adapters           | Reduces renderer adapter duplication.                               |
|    61 | #1208 Bound stream retention in renderer adapters               | Prevents renderer streams from retaining unbounded data.            |
|    62 | #1162 Model React async state with Effect primitives            | Aligns React async state with Effect semantics.                     |
|    63 | #1169 Share scoped runtime helper in Vue adapter                | Aligns Vue with shared scoped runtime helpers.                      |
|    64 | #1170 Share scoped runtime helper in Solid adapter              | Aligns Solid with shared scoped runtime helpers.                    |
|    65 | #1210 Adopt upstream Effect atom adapters                       | Uses Effect reactivity instead of custom renderer state.            |
|    66 | #1211 Move browser storage layers out of React                  | Makes browser storage a provider layer, not React-owned.            |
|    67 | #1173 Decode CLI config through Schema                          | Aligns CLI config with schema decode.                               |
|    68 | #1164 Remove raw create CLI argument parsing                    | Removes hand-rolled CLI parsing from scaffolding.                   |
|    69 | #1187 Read CLI streams with Effect Stream                       | Aligns CLI stream handling with Effect streams.                     |
|    70 | #1191 Integrate telemetry with Effect tracing                   | Adds observability to the runtime substrate.                        |
|    71 | #1199 Stream devtools from Effect runtime signals               | Devtools consume Effect runtime signals.                            |
|    72 | #1175 Add schema-first desktop HTTP APIs                        | Adds local HTTP API after core RPC/layer contracts stabilize.       |
|    73 | #1201 Expose local desktop services through HttpApi             | Exposes local services through the schema-first HTTP API path.      |
|    74 | #1157 Separate memory and durable workflow engines              | Clarifies transient vs durable workflow semantics.                  |
|    75 | #1202 Use Workflow only for durable desktop work                | Prevents workflow overuse for local transient orchestration.        |
|    76 | #1168 Make desktop event log a policy module                    | Stabilizes event log policy for durable features.                   |
|    77 | #1167 Stream workflow devtools from registry changes            | Adds workflow visibility after workflow boundaries are settled.     |
|    78 | #1176 Back cluster panel with cluster services                  | Adds cluster-backed UI after local provider graph is stable.        |
|    79 | #1203 Model release pipelines as Effect workflows and CLI       | Durable release orchestration after core/runtime provider work.     |
|    80 | #1204 Ship architecture templates as executable Effect examples | Turns architecture into executable examples.                        |
|    81 | #1212 Prove or remove the Astro metadata helper                 | Later renderer polish once core adapter patterns settle.            |
|    82 | #1236 Ship Layer-first templates and examples                   | Final public proof of the Layer-first developer experience.         |

## First Pickup Set

Pick these first as one foundation batch:

1. #1227 Codify the Layer-first framework contract
2. #1228 Enforce Layer-first API checks
3. #1229 Introduce the Desktop runtime layer graph
4. #1233 Make generated RPC surfaces Layer-first
5. #1230 Require Live Test and Client layers
6. #1232 Add capability contract test suites

This batch creates the invariant. The rest of the roadmap should be implemented against it.

## Execution Progress

| Issue                                                        | Status      | Evidence                                                                                                                                                                            |
| ------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1227 Codify the Layer-first framework contract              | Implemented | `docs/architecture/layer-first-contract.md`, `tests/layer-first-contract.test.ts`, and the `Screen` Live/Client/Test substitution proof in `packages/test/src/index.test.ts`        |
| #1205 Fix the React API subpath export                       | Implemented | `packages/react/package.json`, `packages/react/src/index.test.ts`, and `docs/learnings/2026-05-12-fix-react-api-subpath-export.md`                                                  |
| #1178 Narrow the core public root export                     | Implemented | `packages/core/src/index.ts`, `packages/core/package.json`, `packages/core/src/index.test.ts`, and `docs/learnings/2026-05-12-narrow-core-root-export.md`                           |
| #1219 Narrow the native public root export                   | Implemented | `packages/native/src/index.ts`, `packages/native/src/contracts/index.ts`, `packages/native/src/index.test.ts`, and `api/snapshots/@effect-desktop__native.snapshot.json`            |
| #1154 Make RpcGroup the only renderer contract               | Implemented | `BridgeRpc.fromGroup`, native capability `Rpc.make`/`RpcGroup.make` contracts, `packages/native/src/index.test.ts`, and API snapshots                                               |
| #1233 Make generated RPC surfaces Layer-first                | Implemented | `DesktopRpc.surface`, `ScreenSurface`, generated server/client/test layers, schema docs, contract laws, and focused core/native tests                                               |
| #1193 Generate desktop surfaces from Effect RpcGroup         | Implemented | `ScreenRpcs` is a pure `RpcGroup`, `ScreenSurface` maps generated RPC clients to `ScreenClient`, and bridge exchange use is isolated in a unary protocol adapter                    |
| #1179 Generate supported native client surfaces              | Implemented | `DesktopRpc.supportedGroup`, `WindowSupportedRpcs`, and the narrowed Window/React/Test client surfaces prove unsupported descriptor methods are not callable client methods         |
| #1264 Replace BridgeRpc runtime DSL with Effect RPC adapters | Implemented | Native capability `*Rpcs` values are plain `RpcGroup`s, host runtimes use `RpcGroup.toLayer(...)` through `makeDesktopRpcHandlerRuntime(...)`, and bridge/native focused tests pass |

## Design-Debt Follow-ups

| Issue                                                                  | Why it matters                                                                    | Relationship                                                                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| #1265 Rebase Filesystem on Effect FileSystem                           | Removes the local filesystem adapter for operations Effect already models.        | Simplifies runtime provider parity, test layers, and later filesystem observability by keeping only desktop policy local. |
| #1266 Model filesystem watches as scoped Effect streams                | Makes watcher lifecycle, cleanup, and backpressure Stream-owned.                  | Complements #1265 and reduces detached fiber/listener risk in runtime services.                                           |
| #1267 Collapse SQLite onto Effect SqlClient                            | Removes the parallel SQLite connection/statement API.                             | Simplifies storage, settings, durable workflows, and SQL test layers by standardizing on Effect SQL.                      |
| #1268 Store window state through KeyValueStore and Schema codecs       | Removes bespoke JSON persistence for window state.                                | Aligns window state with settings persistence and makes state fixtures local-substitutable.                               |
| #1269 Use Effect Redacted for secrets and redaction boundaries         | Replaces local secret/redaction sentinels with Effect's redacted value semantics. | Simplifies secrets, safe-storage, bridge redaction, audit, and Inspector safety work.                                     |
| #1270 Give audit events typed EventGroup payloads                      | Removes `Schema.Unknown` from audit eventlog writes.                              | Makes permission, command, and secrets audit streams safe to consume from Inspector and tests.                            |
| #1271 Generate test native clients from DesktopRpc surfaces            | Removes hand-maintained native test clients.                                      | Simplifies #1232, #1230, and native service migrations by deriving tests from the same RPC contracts.                     |
| #1272 Represent command registrations as Effect RpcGroup endpoints     | Removes the custom command registration DSL.                                      | Lets permissions, schemas, handlers, and test clients share Effect RPC semantics.                                         |
| #1273 Scope command bindings with Effect resources                     | Gives menu/shortcut command bindings owned lifetimes.                             | Builds on #1272 and reduces manual resource/fiber coordination in native services.                                        |
| #1274 Rebase bridge EventHub on Effect PubSub                          | Removes bridge-specific pub/sub queues.                                           | Complements #1182 and #1222 by making event fanout use the same Effect primitive.                                         |
| #1275 Run CLI packaging tools through Effect platform services         | Removes Bun/node globals from release pipelines.                                  | Simplifies package, sign, notarize, publish, and doctor tests with platform substitutes.                                  |
| #1276 Schema-code release manifests and gate evidence                  | Removes ad hoc JSON validators from release artifacts.                            | Strengthens CI/release gates and keeps file boundaries Schema-owned.                                                      |
| #1277 Decode startup environment with Effect Config and Schema         | Removes raw env parsing in startup supervision.                                   | Complements desktop config decoding and prevents new env readers outside Config-backed edges.                             |
| #1278 Remove the custom DesktopAppDefinition builder DSL               | Removes a parallel layer composition model.                                       | Simplifies templates, examples, manifests, and runtime layer graph work by leaning on `Layer`.                            |
| #1279 Centralize retry timeout and polling policy with Effect Schedule | Replaces one-off timing loops with named schedules.                               | Makes host reconnect, release probes, and update retries deterministic and interruptible.                                 |
| #1285 Replace BridgeRpc resource helpers with Schema handles           | Removes the remaining native contract dependency on BridgeRpc resource specs.     | Completes the BridgeRpc simplification after #1264 by making resource handles plain Schema/Core-owned values.             |
| #1280 Delete zero-policy Effect re-export wrappers                     | Removes modules that only rename upstream Effect APIs.                            | Reduces import indirection and reinforces the no-wrapper architecture rule.                                               |
| #1281 Make renderer RPC runtime a scoped layer                         | Removes unsafe scope/global runtime wiring from core renderer RPC.                | Complements #1206 and #1233 by making generated renderer clients layer-scoped.                                            |
| #1282 Shape PTY output as Effect Stream pipelines                      | Replaces manual output queues/coalescing with Stream stages.                      | Complements PTY semaphore work and makes output backpressure/cleanup testable at the stream boundary.                     |
| #1283 Use RpcTest for example app host transports                      | Removes hand-rolled example protocol queues.                                      | Keeps templates/examples aligned with the canonical Effect RPC testing path.                                              |
| #1284 Add guardrails against non-policy Effect wrappers                | Turns the wrapper-removal rule into CI pressure.                                  | Prevents future drift after the current refactor issues land.                                                             |

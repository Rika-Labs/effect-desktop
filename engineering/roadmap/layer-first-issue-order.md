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

## Architecture Debt Follow-Ups

|                                         Issue | Status | Why here                                                                                                                                                        |
| --------------------------------------------: | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|        #1421 Remove Window `windowRpc` helper | Closed | Removes a shallow `NativeSurface.rpc` wrapper that spans the Window parity surface and will simplify later Window lifecycle, bounds, chrome, and state tickets. |
|     #1743 Remove shallow native layer helpers | Closed | Removes pass-through native `make*Layer` exports that mirror Effect `Layer` and generated `NativeSurface` construction instead of owning desktop policy.        |
|       #1744 Model NetworkAuth events by phase | Closed | Replaces the broad `NetworkAuthEvent` phase payload with phase-specific Schema variants so invalid phase/payload combinations are rejected at the boundary.     |
|          #1745 Model Download events by phase | Closed | Replaces the broad `DownloadEvent` phase payload with phase-specific Schema variants so invalid phase/payload combinations are rejected at the boundary.        |
|       #1747 Model CookieStore events by phase | Closed | Replaces the broad `CookieStoreEvent` phase payload with phase-specific Schema variants so invalid phase/payload combinations are rejected at the boundary.     |
|    #1748 Model SessionProfile events by phase | Closed | Replaces the broad `SessionProfileEvent` phase payload with phase-specific Schema variants so invalid phase/payload combinations are rejected at the boundary.  |
| #1785 Remove React window convenience aliases | Closed | Removes zero-policy `currentWindow`/`windows` namespace aliases and duplicate React hooks so the React adapter exposes one Effect-native window contract.       |
|    #1798 Preserve renderer RPC group generics | Closed | Removes the remaining renderer RPC flat-client invocation assertion by reconstructing an invokable Effect RPC union at the erased renderer manifest boundary.   |
|     #1807 Expose production PTY adapter layer | Closed | Connects the checked-in native PTY primitive to the public TypeScript `PTY` service without forcing app code to hand-supply a `PtyAdapter`.                     |
| #1824 Model DisplayCapture events as RPC streams | Closed | Removes the remaining `DisplayCaptureRpcEvents` side object by moving capture lifecycle events into the canonical `DisplayCapture.events.Event` RPC stream. |

## Execution Progress

| Issue                                                          | Status      | Evidence                                                                                                                                                                                             |
| -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1227 Codify the Layer-first framework contract                | Implemented | `engineering/architecture/layer-first-contract.md`, `tests/layer-first-contract.test.ts`, and the `Screen` Live/Client/Test substitution proof in `packages/test/src/index.test.ts`                  |
| #1229 Introduce the Desktop runtime layer graph                | Implemented | `Desktop.runtime`, `Desktop.runtimeGraph`, `DesktopRuntime`, provider selection metadata, and focused `packages/core/src/index.test.ts` runtime graph coverage                                       |
| #1205 Fix the React API subpath export                         | Implemented | `packages/react/package.json`, `packages/react/src/index.test.ts`, and `engineering/learnings/2026-05-12-fix-react-api-subpath-export.md`                                                            |
| #1178 Narrow the core public root export                       | Implemented | `packages/core/src/index.ts`, `packages/core/package.json`, `packages/core/src/index.test.ts`, and `engineering/learnings/2026-05-12-narrow-core-root-export.md`                                     |
| #1219 Narrow the native public root export                     | Implemented | `packages/native/src/index.ts`, `packages/native/src/contracts/index.ts`, `packages/native/src/index.test.ts`, and `api/snapshots/@orika__native.snapshot.json`                                      |
| #1154 Make RpcGroup the only renderer contract                 | Implemented | `BridgeRpc.fromGroup`, native capability `Rpc.make`/`RpcGroup.make` contracts, `packages/native/src/index.test.ts`, and API snapshots                                                                |
| #1233 Make generated RPC surfaces Layer-first                  | Implemented | `DesktopRpc.surface`, `ScreenSurface`, generated server/client/test layers, schema docs, contract laws, and focused core/native tests                                                                |
| #1193 Generate desktop surfaces from Effect RpcGroup           | Implemented | `ScreenRpcs` is a pure `RpcGroup`, `ScreenSurface` maps generated RPC clients to `ScreenClient`, and bridge exchange use is isolated in a unary protocol adapter                                     |
| #1179 Generate supported native client surfaces                | Implemented | `WindowRpcs`, React helpers, and test clients expose only host-backed callable methods instead of descriptor-only planned methods                                                                    |
| #1194 Expose native capability facts as data                   | Implemented | `NativeCapabilities` derives runtime support facts from native `RpcSupport` annotations and treats unknown planned methods as lookup errors                                                          |
| #1177 Remove generated @effect/cluster dependency              | Implemented | `create-orika --include-cluster` keeps cluster APIs on the pinned `effect` package and no longer emits a phantom `@effect/cluster` dependency                                                        |
| #1184 Use Effect serialization for host protocol frames        | Implemented | The host protocol codec module centralizes host frame bytes on Schema JSON transformations, and `host-client` no longer parses or stringifies protocol frames inline                                 |
| #1161 Shape framed transport as Effect socket stream           | Implemented | `makeFramedSocketConnection` binds frame codecs to Effect `Socket`/`Stream`/`Scope`, and the runtime entry provides `layerStdioSocket` instead of a Promise `FramedTransport`                        |
| #1182 Rebase bridge stream state on Effect primitives          | Implemented | `BridgeStreamRegistry` now uses `SubscriptionRef`, active producers are owned by `FiberMap`, and runtime disposal closes active streams through typed terminal state                                 |
| #1155 Move bridge cancellation to Effect interruption          | Implemented | Bridge client methods no longer expose `AbortSignal` call options; unary interruption and early stream finalization send protocol cancel envelopes from Effect finalizers                            |
| #1166 Use RpcTest for demo RPC transports                      | Implemented | Browser examples and adapter tests now use `RpcTest`-backed renderer RPC layers instead of fake queue/fiber host transports                                                                          |
| #1281 Make renderer RPC runtime a scoped layer                 | Implemented | Core renderer RPC now exposes `RendererRpcClients`/`RendererRpcTransport` scoped layers, and framework adapters own `ManagedRuntime` disposal instead of a core unsafe runtime object                |
| #1220 Centralize release target modeling                       | Implemented | CLI build, package, sign, notarize, and publish pipelines now consume `DesktopTargetId`/`DesktopArtifactKind` plus canonical target policy helpers from `packages/cli/src/targets.ts`                |
| #1221 Centralize CSP and nonce policy                          | Implemented | Config owns schema-backed `CspPolicy` data, TS native serving renders from that policy with parser-backed nonce rewriting, and Rust host defaults are generated from the same policy artifact        |
| #1213 Add Bun and Node runtime providers                       | Implemented | Config accepts Bun/Node runtime engines, core selects Bun or Node Effect platform layers, CLI emits normalized runtime launch manifests, and Rust host reads that manifest                           |
| #1214 Prove runtime provider parity                            | Implemented | Core provider conformance runs the same Effect service contract against Bun and Node, runtime stdio no longer depends on `Bun.*`, and Rust supervision tests exercise both providers                 |
| #1230 Require Live Test and Client layers                      | Implemented | `Screen`, `Clipboard`, and `Dialog` expose Live, bridge Client, and deterministic Test layers, with shared substitution coverage in `packages/test/src/index.test.ts`                                |
| #1264 Replace BridgeRpc runtime DSL with Effect RPC adapters   | Implemented | Native capability `*Rpcs` values are plain `RpcGroup`s, host runtimes use `RpcGroup.toLayer(...)` through `makeDesktopRpcHandlerRuntime(...)`, and bridge/native focused tests pass                  |
| #1280 Delete zero-policy Effect re-export wrappers             | Implemented | Core no longer ships `runtime/event-log`, `runtime/reactivity`, or `runtime/workflow` wrapper modules; call sites import upstream Effect primitives directly, and repo-shape tests guard them        |
| #1286 Remove native generated-client casts over Effect RPC     | Implemented | Native bridge clients now use `DesktopRpcClient<*Rpc>` directly, Window no longer double-casts supported clients, and API snapshots record the stricter RPC group signatures                         |
| #1288 Tighten native decode helpers to pure Schema codecs      | Implemented | Native input and event decode helpers now require pure `Schema.Codec` values directly and no longer recover erased schema services with decode-helper `Effect` assertions                            |
| #1289 Make DesktopRpc.supportedGroup type-preserving           | Implemented | `DesktopRpc.supportedGroup` now narrows Effect `RpcGroup` values with a typed support predicate, and Window derives its supported callable group from `RpcSupport` metadata without a manual union   |
| #1290 Tighten bridge contract schemas to pure codecs           | Implemented | Bridge method, event, and stream specs now require pure `Schema.Codec` values, and client/handler/event/stream helpers no longer recover Schema services with encode/decode `Effect` assertions      |
| #1292 Remove BridgeRpc once Effect RPC owns renderer contracts | Implemented | Bridge contracts are now authored with canonical `Rpc.make`/`RpcGroup.make`; the public `BridgeRpc*` DSL exports are removed, and bridge keeps only metadata lowering plus runtime binding helpers   |
| #1285 Replace BridgeRpc resource helpers with Schema handles   | Implemented | Native resource handles are plain Schema/Core-owned values, and package source no longer depends on `BridgeRpc.Resource(...)` specs                                                                  |
| #1163 Preserve approval failures as Effect results             | Implemented | React approval resolution now returns `Exit`, stores per-token `AsyncResult` state, and workflow approval payloads decode capability/actor schemas directly                                          |
| #1278 Remove the custom DesktopAppDefinition builder DSL       | Implemented | `Desktop.make` now returns metadata-only descriptors, runtime lowering is `Desktop.app(App)`, and the custom `pipe`/`provide`/`toLayer` composition path is gone                                     |
| #1274 Rebase bridge EventHub on Effect PubSub                  | Implemented | Bridge event channels now use Effect `PubSub` and `Stream.fromPubSub`; bridge keeps only contract routing, Schema encoding, host event envelopes, and event backpressure mapping                     |
| #1277 Decode startup environment with Effect Config and Schema | Implemented | Runtime startup reads env through Effect `Config`, decodes startup windows and app descriptors with `Schema`, and keeps only dynamic import/window-opening policy in the supervisor                  |
| #1222 Rebase native app events on Effect PubSub                | Implemented | Native app event routing now stores windows/focus/pending replay in `SubscriptionRef`, delivers events through per-window/per-event `PubSub` channels, and exposes state/audit streams directly      |
| #1209 Drive Vite dev runtime with Effect process and socket    | Implemented | Vite dev runtime now spawns through Effect `ChildProcessSpawner`, bridges stdio through `Socket` plus framed transport, serializes restarts with an Effect `Semaphore`, and uses bounded HMR streams |
| #1158 Use Effect child process primitives                      | Implemented | `Process` now spawns through Effect `ChildProcessSpawner`, keeps desktop policy in `Process`, and removes the local process adapter/child-handle mirror layer                                        |
| #1159 Own process exit fibers with scopes                      | Implemented | Process exit observers now run as `forkScoped` fibers in the process scope, and registry-driven disposal interrupts unfinished observers without detached `runFork` fibers                           |
| #1171 Enforce process budgets with semaphores                  | Implemented | Process owner-scope concurrency now uses Effect `Semaphore` values keyed by `RcMap`, with permits held by the process scope instead of manual `Ref` counters                                         |
| #1160 Replace worker adapter with Effect workers               | Implemented | The default Bun worker adapter now runs through Effect `WorkerPlatform`/`Worker.run`, with scoped listener cleanup and no detached callback `runFork` queue writes                                   |
| #1299 Own worker exit observers with scopes                    | Implemented | Worker runtime-exit observers now run as `forkScoped` fibers in a per-worker scope, with disposal-origin state preventing observer-driven cleanup from interrupting itself                           |
| #1172 Enforce worker budgets with semaphores                   | Implemented | Worker owner-scope concurrency now uses Effect `Semaphore` values keyed by `RcMap`, with permits held by the worker scope instead of manual `Ref` counters                                           |
| #1282 Shape PTY output as Effect Stream pipelines              | Implemented | PTY output now composes raw adapter bytes through Effect `Stream` stages for input metrics, coalescing, overflow filtering, buffering, and byte emission instead of a local queue producer           |
| #1298 Own PTY exit observers with scopes                       | Implemented | PTY child-exit observers now run as `forkScoped` fibers in a per-PTY scope, with disposal-origin state preventing observer-initiated cleanup from interrupting itself                                |
| #1183 Gate PTY concurrency with semaphores                     | Implemented | PTY owner-scope concurrency now uses Effect `Semaphore` values keyed by `RcMap`, with permits held by the PTY scope instead of manual `Ref` counters                                                 |

## Design-Debt Follow-ups

| Issue                                                                        | Why it matters                                                                    | Relationship                                                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| #1265 Rebase Filesystem on Effect FileSystem                                 | Removes the local filesystem adapter for operations Effect already models.        | Simplifies runtime provider parity, test layers, and later filesystem observability by keeping only desktop policy local.       |
| #1266 Model filesystem watches as scoped Effect streams                      | Makes watcher lifecycle, cleanup, and backpressure Stream-owned.                  | Complements #1265 and reduces detached fiber/listener risk in runtime services.                                                 |
| #1267 Collapse SQLite onto Effect SqlClient                                  | Removes the parallel SQLite connection/statement API.                             | Simplifies storage, settings, durable workflows, and SQL test layers by standardizing on Effect SQL.                            |
| #1268 Store window state through KeyValueStore and Schema codecs             | Removes bespoke JSON persistence for window state.                                | Aligns window state with settings persistence and makes state fixtures local-substitutable.                                     |
| #1269 Use Effect Redacted for secrets and redaction boundaries               | Replaces local secret/redaction sentinels with Effect's redacted value semantics. | Simplifies secrets, safe-storage, bridge redaction, audit, and Inspector safety work.                                           |
| #1270 Give audit events typed EventGroup payloads                            | Removes `Schema.Unknown` from audit eventlog writes.                              | Makes permission, command, and secrets audit streams safe to consume from Inspector and tests.                                  |
| #1271 Generate test native clients from DesktopRpc surfaces                  | Removes hand-maintained native test clients.                                      | Simplifies #1232, #1230, and native service migrations by deriving tests from the same RPC contracts.                           |
| #1272 Represent command registrations as Effect RpcGroup endpoints           | Removes the custom command registration DSL.                                      | Lets permissions, schemas, handlers, and test clients share Effect RPC semantics.                                               |
| #1273 Scope command bindings with Effect resources                           | Gives menu/shortcut command bindings owned lifetimes.                             | Builds on #1272 and reduces manual resource/fiber coordination in native services.                                              |
| #1275 Run CLI packaging tools through Effect platform services               | Removes Bun/node globals from release pipelines.                                  | Simplifies package, sign, notarize, publish, and doctor tests with platform substitutes.                                        |
| #1276 Schema-code release manifests and gate evidence                        | Removes ad hoc JSON validators from release artifacts.                            | Strengthens CI/release gates and keeps file boundaries Schema-owned.                                                            |
| #1279 Centralize retry timeout and polling policy with Effect Schedule       | Replaces one-off timing loops with named schedules.                               | Makes host reconnect, release probes, and update retries deterministic and interruptible.                                       |
| #1288 Tighten native decode helpers to pure Schema codecs                    | Removes Schema decode helper assertions that recover erased codec services.       | Follows #1286 by keeping native bridge decode boundaries Effect Schema-owned without local type coercion.                       |
| #1290 Tighten bridge contract schemas to pure codecs                         | Removes bridge-wide schema service erasure and encode/decode recovery casts.      | Completes the #1288 cleanup one layer deeper in bridge client, handler, and stream contracts.                                   |
| #1393 Consolidate event-aware native bridge client layers into NativeSurface | Removes repeated per-service event bridge adapters.                               | Simplifies event-capable native surfaces by letting shared native surface wiring own Effect RPC clients and event streams.      |
| #1283 Use RpcTest for example app host transports                            | Removes hand-rolled example protocol queues.                                      | Keeps templates/examples aligned with the canonical Effect RPC testing path.                                                    |
| #1284 Add guardrails against non-policy Effect wrappers                      | Turns the wrapper-removal rule into CI pressure.                                  | Prevents future drift after the current refactor issues land.                                                                   |
| #1287 Make bridge stream runtime an Effect-scoped constructor                | Removes sync scope allocation around `FiberMap` stream ownership.                 | Completes #1182 by making bridge stream runtime acquisition expose its Effect-scoped resource requirements.                     |
| #1293 Enforce permissions on native host RPC runtimes                        | Resolves the permission-looking native metadata that bridge cannot enforce alone. | Completes #1196 for native host runtime serving without making bridge depend on core policy.                                    |
| #1294 Remove ReactDesktop endpoint support casts over generated hooks        | Removes a React adapter `unknown as` recovery around generated endpoint support.  | Keeps ReactDesktop generated RPC hooks type-preserving after the approval-result cleanup exposed nearby React casts.            |
| #1295 Remove Solid and Vue endpoint support casts over generated hooks       | Removes Solid/Vue `unknown as` recovery around generated endpoint support.        | Completes the renderer-adapter version of the #1294 cleanup after #1278 exposed the same cast pattern outside React.            |
| #1296 Remove core Desktop runtime Layer variance casts                       | Removes core `as unknown as` recovery around dynamic Layer composition.           | Keeps the post-#1278 descriptor/runtime split type-preserving without hiding Effect Layer requirements behind casts.            |
| #1312 Remove Effect RPC boundary type assertions                             | Removes bridge/core `unknown as` recovery around Effect RPC and Layer wiring.     | Keeps heterogeneous desktop RPC registration type-preserving without hiding Effect RPC contracts behind casts.                  |
| #1755 Expose Desktop.rpc server protocol requirements                        | Removes the remaining `Desktop.rpc` server-layer assertion over Effect RPC.       | Makes the public runtime RPC layer type expose `RpcServer.Protocol` and schema/middleware requirements instead of erasing them. |

## Native Parity Follow-ups

These issues remain open after the 2026-05-18 native parity pass. The current code keeps unsupported host behavior fail-closed with typed `Unsupported` results and documents the support truth in `docs/reference/native/parity-matrix.md`.

| Order | Issues                                                 | Dependency reason                                                                                                                                                                                           |
| ----: | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | #1406, #1371, #1372                                    | OS-enforced execution isolation must exist before process, sidecar, utility process, or worker parity can claim filesystem/network isolation.                                                               |
|     2 | #1331, #1332, #1333, #1334                             | Updater, crash reporting, power monitor, and system appearance need platform adapters with artifact/event ownership before support metadata can become true.                                                |
|     3 | #1335, #1336, #1337, #1338, #1339, #1340               | App lifecycle, single-instance, deep-link, association, recent document, and autostart work touches OS process/application state and must stay host-owned.                                                  |
|     4 | #1342, #1343, #1344, #1345, #1346, #1347               | Window parity should continue on the existing `Window` boundary; avoid adding separate window lifecycle, placement, chrome, z-order, or ownership wrapper surfaces.                                         |
|     5 | #1350, #1351, #1352, #1353, #1354, #1355, #1356        | WebView parity needs host-routed resource ownership, policy, preload isolation, inspection, document output, runtime events, and frame identity before higher browser services build on it.                 |
|     6 | #1357, #1358, #1359, #1360, #1361, #1362, #1363, #1364 | Session/profile handles should land before cookie store, browsing data, browser permissions, downloads, network auth, web request interception, and native network transport.                               |
|     7 | #1366, #1367, #1368, #1369, #1370                      | Menu/context commands, dock/taskbar, shortcuts, safe storage, and filesystem watchers are platform adapters over existing contracts; keep unsupported paths explicit until host behavior is real.           |
|     8 | #1408, #1409                                           | Attachment intake and selection/document context are privacy-sensitive host adapters; support should only turn true after native intake/context sources, lifecycle cleanup, and event streams are verified. |

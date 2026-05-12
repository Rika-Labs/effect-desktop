---
name: sdk-framework-design
description: Review and design SDK, framework, and public package abstractions for Effect Desktop. Use when creating, changing, or reviewing public APIs, package boundaries, facades, developer-facing workflows, generated clients, bridge contracts, framework adapters, templates, examples, or any abstraction that should feel durable, idiomatic, minimal, testable, observable, compatible with Effect, and suitable for eventual upstream Effect ecosystem adoption.
---

# SDK Framework Design

## Decision

Design the public surface first, then make the implementation prove it.

Effect Desktop should feel like a natural Effect package: Effect primitives where they already fit, narrow desktop-specific modules where the desktop domain adds real complexity, and no shallow wrapper layer that users must learn instead of Effect.

Pair this skill with `effect` for every Effect-facing API.

## First Principles

An SDK or framework is a contract for other engineers' production systems. The cost of a bad abstraction is not paid when it is merged; it is paid every time a user debugs, upgrades, tests, or works around it.

Design from these invariants:

- The public API is the product.
- Examples are executable design tests.
- Errors, defaults, serialized shapes, names, and visible behavior are compatibility surface.
- Runtime behavior matters as much as type shape: cancellation, cleanup, retry, timeout, backpressure, logs, traces, and metrics must be designed.
- A framework abstraction must hide real complexity. A wrapper that hides only the original name is debt.
- Deep modules beat shallow modules. One narrow, strong entry point is better than many thin facades.
- Users should learn Effect once and reuse that knowledge across Effect Desktop.

## Grounding Workflow

1. Read the spec and local rules.
   Start with `docs/SPEC.md`, repo `AGENTS.md`, and any package README or milestone doc covering the area.

2. Read existing code.
   Search current packages, templates, examples, tests, and API snapshots. Preserve local naming and package boundaries unless there is a specific reason to change them.

3. Read the `effect` skill.
   If the abstraction touches effectful code, inspect `vendor/effect/LLMS.md`, `vendor/effect/ai-docs/src/**`, and the relevant `vendor/effect/packages/**` source before designing.

4. Ground external conventions.
   If the decision depends on SDK, HTTP, RPC, OpenAPI, TypeScript, OS, browser, Rust, or package-manager behavior, verify it from official docs or source.

5. Write the hero code.
   Draft the code a user should write for the most important scenario. Include setup, success, expected failure, cleanup, and test substitution.

6. Decide whether an abstraction deserves to exist.
   Keep it only if it hides desktop-specific complexity, stabilizes a policy, narrows a dangerous API, or composes several Effect primitives into a stronger domain module.

7. Define the contract.
   Document names, inputs, outputs, typed errors, default behavior, lifecycle ownership, observability, test strategy, unsupported cases, and compatibility promises.

8. Implement minimally.
   Put complexity downward in the module that owns it. Keep pure cores separate from Effect services and platform adapters.

9. Prove it.
   Run the exact path when possible. Otherwise run the focused test. Public APIs need tests that exercise success, typed failure, cleanup, and user-level testability.

## Abstraction Admission Test

An abstraction can enter the public SDK only if it passes all of these:

- **Concept:** It names one real concept. It does not mix transport, policy, state, and domain.
- **Reason:** It hides complexity the caller should not repeat.
- **Substrate:** It is backed by an Effect primitive or a clear host capability.
- **Boundary:** Its inputs and outputs are typed and validated where data crosses trust/process/persistence boundaries.
- **Failure:** Its expected failures are typed, tagged, recoverable, and testable.
- **Lifecycle:** It has explicit ownership for resources, background work, and cleanup.
- **Observation:** It emits or preserves logs, spans, metrics, request IDs, trace IDs, and enough error context for incident work.
- **Compatibility:** Its defaults, names, serialized shapes, and visible behavior can survive minor releases.
- **Testability:** Users can test code against it without a real desktop host, network service, database, or OS permission prompt.
- **Escape hatch:** Advanced users can reach the underlying Effect or protocol evidence without forking.

If one item fails, fix the design before implementing.

## Public Surface Rules

### Entry Points

- Provide one obvious primary entry point per package or domain.
- Place the most common public types at the package root.
- Put advanced or specialized surfaces behind clear submodules.
- Avoid "manager", "handler", "util", and "helper" names unless the noun is truly the domain concept.
- Do not expose multiple names for the same concept.

### Naming

- Use concrete domain nouns: `Window`, `Command`, `Permission`, `Resource`, `Bridge`, `Runtime`.
- Use one word for one concept across runtime, bridge, docs, examples, errors, and snapshots.
- Use operation verbs consistently: `create`, `get`, `list`, `update`, `delete`, `watch`, `open`, `close`, `run`.
- Use `Options` for optional operation policy/input bags and `Result` for non-resource operation results.
- Include units in numeric names: `timeoutMs`, `maxBytes`, `retryDelay`, or use `Duration` to avoid unit ambiguity.
- Avoid brand or implementation names in domain models unless the user is directly choosing that implementation.

### Construction

- Require the minimum information needed for the first useful operation.
- Put optional behavior in an options object only when the options belong to the same policy level.
- Do not mix dependencies and operation input in one options bag.
- Prefer layer/service construction for effectful dependencies.
- Do not expose mutable config objects after construction.

### Return Values

- Return the logical entity for the common path.
- Preserve access to raw response/protocol evidence where debugging requires it.
- Use `Stream` for sequences over time or unbounded data.
- Use `Effect.Effect<A, E, R>` for effectful public TypeScript APIs.
- Use promises only at explicit integration boundaries.

### Errors

- Treat errors as part of the API contract.
- Use tagged errors with stable names and machine-readable reasons.
- Keep human messages actionable, but do not make string parsing the recovery mechanism.
- Preserve underlying cause when it helps incident diagnosis.
- Distinguish usage errors, permission errors, validation errors, host errors, transport errors, timeout, cancellation/interruption, and defects.

### Defaults

- Defaults must be durable.
- Changing a default can break semantic compatibility.
- If a policy may need to change, make it explicit in options and choose a conservative default.
- Document default service/API/protocol versions where relevant.

### Compatibility

Check three compatibility axes:

- **Source compatibility:** old user code still typechecks.
- **Wire compatibility:** old clients and new servers/hosts still encode/decode correctly.
- **Semantic compatibility:** old user code still receives behavior a reasonable developer would expect.

Breaking changes include removing or renaming public types, changing field types, changing serialized presence/default behavior, changing error tags/reasons, changing idempotency, narrowing accepted values, changing resource names, and changing when I/O happens.

## Operational Rules

### Cancellation And Timeouts

- Every async I/O path must participate in Effect interruption.
- Define operation timeout vs attempt timeout when retrying.
- Do not bury uninterruptible promises in core code.
- Surface cancellation behavior in examples when the operation can be long-running.

### Retry And Idempotency

- Use Effect `Schedule` for retry and polling.
- Retry only when the operation is idempotent or has an idempotency key / replay-safe protocol.
- State which errors are retryable.
- Log retry attempts and next delay where useful.

### Resources And Cleanup

- Any handle, process, stream, watcher, socket, subscription, worker, database connection, or host resource must have one owner.
- Encode ownership with `Scope`, scoped layers, streams, or explicit release APIs.
- Tests must prove cleanup for failure and interruption, not only success.

### Backpressure

- Use `Stream`, `Queue`, `PubSub`, `Channel`, and platform stream adapters instead of ad-hoc callbacks for data over time.
- Preserve backpressure across bridge and host boundaries.
- Do not buffer unbounded data in memory for convenience.

### Observability

- Add spans around user-visible operations and boundary crossings.
- Annotate logs with domain identifiers, trace IDs, request IDs, window/session/resource IDs, and retry/cancellation context.
- Emit metrics for volume, latency, failure class, queue depth, resource count, and retry behavior where operationally meaningful.
- Never log secrets, tokens, credentials, or redacted config values.

## Package Boundary Rules

- `core` contains framework-domain semantics, not app-specific logic.
- Bridge packages own typed contracts and validation.
- Runtime/platform packages own host and adapter integration.
- Framework adapters own framework-specific ergonomics only.
- Templates and examples prove the public API; they should not depend on private package internals.
- Shared packages are justified only when users directly consume the shared types or when multiple public packages must share a stable contract.
- New runtime dependencies require the repo's dependency policy: ADR or package README note unless already spec-mandated.

## Effect Desktop Fit

Before adding any Effect Desktop abstraction, map it to Effect:

- Services and dependencies map to `Effect.Service`, `Context.Tag`, and `Layer`.
- Runtime wiring maps to `Layer.launch`, platform runtimes, and `ManagedRuntime`.
- Typed boundaries map to `Schema.Class`, schema errors, RPC, HTTP API, or bridge schemas.
- Event feeds map to `Stream`, `PubSub`, `Queue`, `SubscriptionRef`, or reactivity.
- Long-running local work maps to fibers, queues, schedules, and scopes.
- Durable work maps to workflow, persistence, eventlog, SQL, and cluster when needed.
- Distributed state maps to cluster entities and runners.
- User testability maps to layers, test runners, test clocks, HttpApi/Rpc tests, and fixture protocols.

If the proposed API ignores the matching Effect primitive, stop and re-derive.

## Documentation And Examples

Every public abstraction should have examples for:

- First useful operation.
- Expected failure and recovery.
- Cancellation or timeout when applicable.
- Resource cleanup.
- Test substitution.
- Observability or debugging evidence for boundary calls.

Examples should be small but real. They should not skip permissions, cleanup, validation, or error handling if those are part of the contract.

## Review Questions

- What is true now?
- What must remain true after this change?
- What user code do we want to make possible?
- What complexity does this abstraction hide?
- Which Effect primitive backs it?
- Which boundary validates input and output?
- Which typed errors can the user recover from?
- Who owns lifecycle and cleanup?
- What happens on interruption?
- What happens on retry?
- What happens on app restart or host crash?
- How does a user test this offline?
- What evidence exists in logs/traces/metrics when it fails?
- Which future change would break this API?
- What is intentionally out of scope?

## Red Flags

- A facade has the same shape as the Effect API underneath it.
- A new manager object owns state but does not define lifecycle, scope, or cleanup.
- An options bag mixes policy, dependencies, transport, and operation inputs.
- An error message is the only machine-readable error contract.
- A generated client exposes protocol details as the main experience.
- A convenience API prevents tracing, cancellation, retry, or test-layer substitution.
- A package adds a dependency to solve a problem Effect or the repo already solves.
- An example works only by ignoring permissions, cleanup, backpressure, or failure.
- A public type names implementation details rather than the user concept.
- A test only checks compilation, not behavior.
- A design requires docs to explain around surprising behavior instead of fixing it.

## References

Read [references/sdk-framework-research.md](references/sdk-framework-research.md) when designing a new public surface, reviewing a large API change, or explaining why an abstraction should or should not exist.

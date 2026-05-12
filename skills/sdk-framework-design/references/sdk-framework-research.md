# SDK and Framework Research Notes

Use these notes as design pressure, not as a replacement for repo constraints.

## Sources

- Azure SDK general API design: https://azure.github.io/azure-sdk/general_design.html
- Azure SDK TypeScript API design: https://azure.github.io/azure-sdk/typescript_design.html
- Azure SDK implementation guidance: https://azure.github.io/azure-sdk/general_implementation.html
- Microsoft Azure service design considerations: https://github.com/Microsoft/api-guidelines/blob/HEAD/azure/ConsiderationsForServiceDesign.md
- Google Cloud API design guide: https://docs.cloud.google.com/apis/design
- Google AIP-180 backwards compatibility: https://cloud.google.com/apis/design/compatibility
- Microsoft Framework Design Guidelines: https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/
- AWS SDK for JavaScript effective practices: https://github.com/aws/aws-sdk-js-v3/blob/main/supplemental-docs/EFFECTIVE_PRACTICES.md
- AWS SDK for Java best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html

## Source Synthesis

### Azure SDK Design

Azure's SDK guidelines put the most design weight on the client library API because it is the user's primary interaction with the service. They emphasize:

- Clear root namespaces and discoverable entry points.
- A minimized number of clients so users know where to start.
- Consistent operation verbs across a service family.
- Minimal construction requirements.
- Feature completeness for the represented service.
- Explicit service/API versions.
- Logical entity return values for common cases.
- Access to full/raw response evidence when needed.
- Cancellation, retry, and logging as expected network capabilities.
- TypeScript strictness and idiomatic TypeScript declarations.

Effect Desktop translation:

- Package root exports should expose the common path.
- Specialized APIs can live in submodules, but not because the root is disorganized.
- Public APIs should be TypeScript-strict and Effect-native.
- Raw host/protocol details should be available, but not the default mental model.

### Azure Implementation

Azure implementation guidance emphasizes shared core behavior, diagnostics, robust error handling, OpenTelemetry, mockable clients, recorded/offline tests, and dependency restraint.

Effect Desktop translation:

- Use Effect for common runtime behavior instead of adding bespoke helper packages.
- Use spans/logs/metrics as part of the abstraction, not an afterthought.
- Provide test layers and protocol fixtures for user code.
- Avoid dependencies unless they are clearly safer than local or Effect-provided code.

### Microsoft Service/API Design

Microsoft's service design guidance starts with developer experience, hero scenarios, names, compatibility, previews, idempotency, and errors.

Effect Desktop translation:

- Write user examples before finalizing API shape.
- Prefer fewer complete workflows over broad partial surfaces.
- Name resources and operations from user concepts, not host internals.
- Treat error tags and recovery semantics as contract.
- Make retry-safe operations idempotent or explicitly not retried.

### Google API Design And AIP-180

Google's design guide frames APIs as long-lived contracts. AIP-180 separates compatibility into source, wire, and semantic compatibility.

Effect Desktop translation:

- A schema change can be breaking even if TypeScript still compiles.
- A default change can be breaking even if the type shape is unchanged.
- Field presence, resource names, serialized values, and enum/tag expansion need compatibility review.
- Renaming is remove-plus-add; avoid it in public surfaces.

### Microsoft Framework Design Guidelines

Microsoft's framework guidelines stress consistency and ease of use across reusable libraries, while acknowledging that deviations need clear justification.

Effect Desktop translation:

- Public APIs should feel designed by one team.
- Deviations from Effect naming or semantics need a written reason.
- A framework should be predictable enough that users can guess the next API after learning one.

### AWS SDK Operational Practices

AWS SDK guidance repeatedly highlights operational hazards:

- Reuse clients instead of repeatedly constructing them.
- Do not mutate resolved client config.
- Always consume or close streams.
- Configure timeouts to avoid hanging requests.
- Close unused clients and streams to avoid resource exhaustion.
- Monitor client performance with metrics.

Effect Desktop translation:

- Runtime clients and host resources should be layer-managed or scoped.
- Config should be immutable after construction unless updated atomically through a service API.
- Streams must have clear consumption/cancellation semantics.
- Long-running calls need timeout and metrics policy.

## Design Doctrine For Effect Desktop

### Public API Shape

- One obvious entry point per domain.
- Root exports for common user-facing APIs.
- Submodules for advanced/raw/platform-specific surfaces.
- Names based on domain concepts.
- Stable `Options` and `Result` shapes.
- Public effectful APIs return `Effect.Effect<A, E, R>`.
- Boundary helpers may expose promises only when integrating with non-Effect frameworks.

### Contract Stability

Treat these as public contract:

- Type names.
- Operation names.
- Error tag names and reason fields.
- Schema field names, optionality, defaults, and encoded formats.
- Stream element shape and completion/error semantics.
- Resource ownership and cleanup behavior.
- Retry and idempotency behavior.
- Timeout defaults.
- When I/O occurs.
- Observability attributes that users depend on for operations.

### Operational Design

Every effectful abstraction should define:

- Cancellation behavior.
- Timeout behavior.
- Retry policy and idempotency requirement.
- Resource ownership.
- Backpressure model.
- Logging/tracing/metrics.
- Test layer or mock protocol.
- Security/redaction behavior.

### Dependency Design

Before adding a dependency:

1. Search Effect core/platform/unstable modules.
2. Search this repo for existing utilities.
3. Check whether the dependency becomes public API.
4. Check version conflict risk.
5. Check license and maintenance risk.
6. Add ADR or README note if required by repo policy.

### Test Design

Public SDK tests should include:

- Type-level API expectation when useful.
- Runtime success path.
- Expected failure path with typed recovery.
- Boundary validation failure.
- Cleanup on success.
- Cleanup on failure or interruption.
- Offline/mocked user test story.
- Snapshot/API extractor check when public shape changes.

## Anti-Patterns

- `FooManager` that only stores mutable state and forwards calls.
- `DesktopEffect` wrapper that hides Effect names without adding desktop semantics.
- Promise API in core packages because it feels familiar.
- Error strings with no stable tags.
- Options objects that include transport, dependencies, and business input together.
- Generated clients that force users to understand protocol envelopes.
- Retrying non-idempotent operations.
- Streams converted to arrays for convenience.
- Test fixtures that require a live host or external service for ordinary user code.
- Convenience APIs that make tracing or cancellation impossible.

## What "Upstreamable To Effect" Means

An abstraction has a plausible path into the Effect ecosystem when:

- It composes Effect primitives without obscuring their semantics.
- Its contract is typed, lawful, and testable.
- It separates pure model from platform adapters.
- It exposes capability through services/layers, not globals.
- It handles resources through scopes/finalizers.
- It is useful beyond one app's business logic.
- It does not introduce dependency or platform coupling into core concepts.
- It has examples that read like normal Effect code.

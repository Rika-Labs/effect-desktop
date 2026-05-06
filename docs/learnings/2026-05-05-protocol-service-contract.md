---
date: 2026-05-05
type: in-flight-feature
topic: Protocol service for arbitrary custom URL schemes beyond app://
issue: https://github.com/Rika-Labs/effect-desktop/issues/53
pr: https://github.com/Rika-Labs/effect-desktop/pull/194
---

# Protocol service for arbitrary custom URL schemes beyond app://

## What we set out to do

Issue #53 asked for a Phase 8 `Protocol` service so apps can configure custom
URL schemes beyond the built-in `app://` handler. The important invariant was
that custom protocol inputs stay typed and validated before they reach WRY or
WebView policy, because a loose protocol handler can turn convenience asset
serving into origin or file-boundary confusion.

## What actually ended up working

The implementation adds a serializable service contract: `registerAppProtocol`,
`serveAsset`, `serveRoute`, and `deny`. The bridge client validates custom
schemes before transport, rejects reserved schemes such as `app`, `file`,
`http`, and `https`, and checks route/deny paths for absolute shape and `..`
segments. WebView origin policy remains owned by `WebView`; `Protocol` prepares
the custom-scheme boundary but does not duplicate navigation policy.

```mermaid
flowchart LR
  AppCode[App code] --> Protocol[Protocol Effect service]
  Protocol --> Validate[scheme and path validation]
  Validate --> Bridge[validated host envelopes]
  Bridge --> Host[custom protocol adapter]
  Host --> WebView[custom-scheme request]
```

## What surfaced in review

No review threads were opened. The local `/code-review` pass focused on the
intentional mismatch between the issue's prose, which talks about function
handlers, and the current bridge contract, which is schema/JSON based. The
locked architecture kept the PR to the serializable contract slice and made that
trade-off explicit instead of smuggling function-valued handlers through a
transport that cannot represent them.

## First-principles postmortem

The primitive boundary is not "serve a file"; it is "accept a URL-shaped request
only after the scheme and path have been classified." That makes validation a
contract responsibility, while file resolution, MIME detection, and WRY callback
lifecycle stay below the host adapter boundary where they can be implemented
with real platform state.

## Game-theory postmortem

The bad local move would be to fake handler support in TypeScript by accepting a
function and dropping it before bridge transport. That would make the API look
complete while hiding a broken principal-agent relationship: app code would
believe it registered behavior that the host never received. Keeping the surface
serializable makes unsupported future behavior loud in review and forces the
eventual host implementation to add a real callback mechanism instead of relying
on caller trust.

## Non-obvious lesson

Function-shaped APIs are not neutral at a process boundary. If a bridge is
schema-driven, a function parameter is a promise of callback machinery; without
that machinery, the honest API is a smaller serializable contract plus typed
validation.

## Reproducible pattern (if any)

- Do not add function-valued parameters to native services unless the bridge has
  a real callback/event protocol for them.
- Put scheme and path validation before host transport for protocol-like APIs.
- Keep navigation/origin policy in WebView even when Protocol config influences
  what URLs can be served.

## AGENTS.md amendment candidate (if any)

For schema-based native services, do not model function-valued public arguments
until the bridge has explicit callback semantics for that function. Why: a
function parameter that cannot cross the boundary creates false confidence.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it -
`/learn` never auto-edits AGENTS.md.

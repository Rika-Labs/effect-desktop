---
date: 2026-05-17
type: in-flight-feature
topic: Implement RealtimeMediaSession host media
issue: https://github.com/Rika-Labs/effect-desktop/issues/1402
pr: none
---

# Implement RealtimeMediaSession host media

## Decision

Native capability support must be proven by the same host control path that will operate the resource; a TypeScript surface and a bridge method are not enough to call a primitive closed.

## What changed

The issue architecture held at the coarse boundary: the TypeScript `RealtimeMediaSession` service owns Schema validation, typed errors, memory or bridge clients, and profile/session stream filtering, while the Rust host owns CPAL-backed device discovery, stream open/play, selected-device state, session ownership, interruption events, and cleanup.

The implementation made support stricter than the original diagram. `isSupported` now means runtime startup verification, not platform declaration. macOS reports partial verified support through the host media path, while platforms that cannot synchronously prove CPAL startup return typed `host-media-startup-unverified`. Native event streams also call support first, so subscribers receive typed unsupported failures instead of silently attaching to a path that cannot produce real host media events.

Review changed the lifecycle shape. Stream callbacks enqueue control-plane cleanup instead of locking the session registry or emitting directly. `open` records the session before `play` and rolls back if playback fails. Cancel cleanup keys off the open request id or resource id because host `Cancel` envelopes do not carry the original method payload. Disconnect and window cleanup drop host media streams before the runtime writer channel is joined.

## Why it mattered

The invariant is that a closed native primitive must either perform release-facing behavior through the real host or return typed unsupported strongly enough that callers cannot mistake a stub for production cleanup.

The local failure mode was milestone pressure: a coherent Effect service and bridge contract can make progress look real while deferring the host lifecycle. Making startup verification, event unsupported behavior, and cleanup observable at the boundary prevents a bad equilibrium where prerelease primitives are "closed" but only locally correct.

## Example

```ts
const support = yield* RealtimeMediaSession.isSupported

if (!support.supported) {
  return yield* Effect.fail(
    new HostProtocolUnsupportedError({
      method: "RealtimeMediaSession.events",
      reason: support.reason ?? "host-media-startup-unverified"
    })
  )
}
```

## Rule candidate

Native capability support claims must be backed by synchronous startup verification on the operating control path. Unsupported capability and device/open failures must be modeled as typed failures that reach subscribers through the event stream, and native callbacks must schedule control-plane cleanup instead of directly mutating shared session state.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.

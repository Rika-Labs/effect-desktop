## Domain

Read-only OS-state support guards for `Screen`, `PowerMonitor`, and `SystemAppearance`, because Appendix K marks several rows partial or unsupported but the services do not expose guard calls.

## Evidence gathered

- `engineering/SPEC.md` §11.0 / Appendix K — apps must call `<Primitive>.isSupported(method)` before non-✓ methods; affected rows are `Screen.getPointerPoint`, `PowerMonitor.onPowerSourceChanged`, `SystemAppearance.getAppearance`, `SystemAppearance.onAppearanceChanged`, and `SystemAppearance.getAccentColor`.
- `packages/native/src/screen.ts` — `Screen` exposes only three read methods; no support method exists.
- `packages/native/src/power-monitor.ts` — `PowerMonitor` is event-only; no request method can answer source-change support.
- `packages/native/src/system-appearance.ts` — `SystemAppearance` exposes reads and one event stream; unsupported client currently returns fallback values for reads and only fails the event stream.
- `packages/native/src/dock.ts` and `packages/native/src/global-shortcut.ts` — existing guard pattern uses an `isSupported` API method with permission `"none"` and maps a result wrapper to a public boolean or support result.
- `engineering/learnings/2026-05-06-linux-polish-capability-probes.md` — support probes are source-of-truth code and must be platform-scoped.

## Prior art in this repo

`Dock.isSupported(method)` is the closest local shape: a method enum, `DockIsSupportedInput`, `DockSupportedResult`, bridge-side input validation, unsupported-client negative answers, and service-level boolean mapping. `GlobalShortcut.isSupported()` adds a diagnostic reason when a single feature has known failure modes. No prior art exists for event-only guard methods, but the API contract supports request methods and event streams on the same primitive.

## First-principles decomposition

- Primitive facts: a guard is a read-only capability query; it must not perform the guarded operation or subscribe to the guarded stream.
- Invariants: non-✓ Appendix K rows are observable before use; support answers are typed; unsupported clients fail closed.
- Constraints: existing public method calls should stay intact; host routing is out of scope; Effect v4 service/layer shapes must remain consistent.
- Failure modes: a fabricated positive guard sends apps into unsupported operations; a missing guard leaves production checks with no expression to recognize; a fallback read hides unsupported platform state.
- Source of truth: Appendix K names which methods require guards; the platform adapter owns the actual support answer.

## Game board

- Players: app authors, production checker, native service maintainers, host adapters.
- Incentives: call simple read APIs directly; keep event streams event-only; avoid widening public contracts.
- Information asymmetries: Linux session and desktop-environment facts are known at the adapter, not at app code.
- Bad local move: return default values or let first use discover unsupported state.
- Global cost: production apps depend on state that exists only on some sessions, and compliant code cannot prove it guarded the call.
- Desired equilibrium: every partial or unsupported OS-state method has a stable guard API that is cheaper to call than the operation.

## Library / API / pattern landscape

`isSupported(method)` per primitive is the spec-backed shape and matches Dock. Per-method booleans would be simpler locally but diverge from §11.0 and production-check wording. Returning reason objects is useful for known environment failures, but the issue only requires a typed probe surface.

## Constraints and edge cases discovered

- `PowerMonitor` needs an API request method even though the primitive otherwise only exposes events.
- `SystemAppearance.onAppearanceChanged` is an event name, not a request method; its guard input must still be a typed method/event literal.
- `getAccentColor` is explicitly unsupported on Linux, but current unsupported clients return `null`; the guard must expose that unsupported state without relying on the read.
- Guard methods should use permission `"none"` because they disclose capability, not privileged OS state.

## Open questions for /interview

1. Should support results remain boolean-only for these primitives, or should they include diagnostic reasons like `GlobalShortcut`?

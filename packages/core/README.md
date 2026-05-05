# @effect-desktop/core

> **Status:** Phase 2 runtime entry exists; the public API remains reserved for Phase 4+. See `docs/SPEC.md`.

## Purpose

Public framework API and runtime contracts (`Desktop.run`, `Desktop.window`, `Desktop.Api`, `Desktop.Resource`, `Desktop.Command`, `Desktop.Capability`, `Desktop.Errors`, `Desktop.Config`).

## Public API

Not yet defined. Phase 0 ships an empty barrel export only.

## Runtime entry

```bash
bun src/runtime/main.ts
```

The runtime entry emits exactly one newline-terminated JSON ready event to stdout:

```json
{ "event": "runtime.ready", "version": "0.0.0" }
```

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
// Reserved for Phase 4+.
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

None until the package implements native-touching primitives.

## Internal architecture

To be documented as the package is built out.

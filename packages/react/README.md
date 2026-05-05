# @effect-desktop/react

> **Status:** Phase 6 public surface. The provider and value-returning hooks are intentionally minimal while the renderer template lands; stream/resource hooks are populated by later Phase 6 issues.

## Purpose

Thin React integration for renderer clients: `DesktopProvider`, `useDesktop`, `useDesktopStream`, `usePermission`, `useWindow`, `useResource`.

## Public API

- `DesktopProvider` supplies a public `DesktopClient` to renderer components.
- `useDesktop` returns `Option.Option<DesktopClient>` instead of throwing when no provider is mounted.
- `useWindow` returns `Option.Option<DesktopWindowClient>`.

## Dependency note

`react` is a peer dependency because host apps own their renderer runtime. `@effect-desktop/bridge`, `@effect-desktop/native`, and `effect` are package dependencies because the public hook surface exposes typed bridge/window Effect values.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { Option } from "effect"
import { useDesktop } from "@effect-desktop/react"

export function Toolbar() {
  const desktop = useDesktop()

  if (Option.isSome(desktop)) {
    // desktop.value.Window.create(...)
  }

  return null
}
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

The package is renderer-only. Native operations stay represented as Effect values supplied by the desktop client.

## Internal architecture

React context stores an optional desktop client. Absence is modeled as `Option.none()` so renderer code can branch explicitly instead of catching provider errors.

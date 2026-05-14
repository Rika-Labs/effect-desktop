---
title: Quickstart
description: The shortest path from an installed workspace to a working RPC call.
kind: reference
audience: app-developers
effect_version: 4
---

# Quickstart

> The full walkthrough lives at [`start/first-app.md`](start/first-app.md). This page is the release-gated reference summary.

Five steps from a freshly installed workspace to a typed RPC call returning to a React component:

1. Define an `RpcGroup` (the contract).
2. Implement handlers via `RpcGroup.toLayer(...)`.
3. Build a `Desktop.make({...})` and `Desktop.manifest(App)`.
4. Render with `ReactDesktop.from(Manifest).useDesktop(group)`.
5. `bun run dev` from `apps/inspector` (or your own renderer).

## Renderer call shape

```tsx
import { Desktop } from "@effect-desktop/core"
import { WindowRpcs } from "@effect-desktop/native"
import { ReactDesktop } from "@effect-desktop/react"
import { App } from "./app"

const DesktopApp = ReactDesktop.from(Desktop.manifest(App))

export function Toolbar() {
  const window = DesktopApp.useDesktop(WindowRpcs)
  const createWindow = window.create.useMutation()

  return (
    <button
      disabled={createWindow.status === "running"}
      onClick={() => createWindow.run({ title: "Notes" })}
    >
      Open
    </button>
  )
}
```

## Verify the public helpers

```ts run
import { ReactDesktop } from "../packages/react/src/index.js"
import { WindowRpcs } from "../packages/native/src/index.js"

if (typeof ReactDesktop.from !== "function" || WindowRpcs === undefined) {
  throw new Error("ReactDesktop or WindowRpcs is unavailable")
}
```

## Where to go next

- [Tutorial 01 — Build a notes app](tutorials/01-build-a-notes-app.md) extends this skeleton into a real app.
- [How-to: define an RPC surface](how-to/define-an-rpc-surface.md) is the recipe.
- [`Desktop` API reference](reference/desktop-api.md) lists every method.

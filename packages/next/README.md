# @orika/next

Next.js client-component adapter for app-scoped ORIKA RPC groups.

## Purpose

`@orika/next` is a `"use client"` boundary over the React adapter. It
keeps desktop RPC access in client components while allowing Next applications to
use their normal routing and server-component model.

## Public API

- `NextDesktop.from(manifest)` creates a Next client adapter for one desktop app
  manifest.
- `createRoot(children, props?)` creates the React desktop provider element.
- `DesktopRoot` is the underlying client provider component.
- `useDesktop(group)` derives endpoints from the imported `RpcGroup`.

Endpoint shapes match `@orika/react`: queries use `useQuery`, mutations
use `useMutation`, streams use `useStream`, and every endpoint exposes `support`
and `isSupported`.

## Non-goals

- This package does not expose server-component desktop RPC APIs.
- This package does not define desktop APIs. Use `Rpc.make`, `RpcGroup.make`, and
  `Desktop.rpc(group, handlers)` in app code (compose multiple via `Desktop.rpcs`).
- This package does not open startup windows. Startup windows belong to
  `Desktop.make({ windows })` and the host runtime.
- This package does not own the app's Next.js version.

## Usage

```tsx
"use client"

import { Desktop as DesktopCore } from "@orika/core"
import { NextDesktop } from "@orika/next"
import { App, NotesRpcs } from "../desktop/app"

export const Desktop = NextDesktop.from(DesktopCore.manifest(App))

export function NotesProviders(props: { readonly children: React.ReactNode }) {
  return Desktop.createRoot(props.children)
}

export function NotesList() {
  const notes = Desktop.useDesktop(NotesRpcs)
  const list = notes.list.useQuery()
  return null
}
```

Server components should pass data through normal Next mechanisms. Desktop RPCs
belong to client components because they are renderer-to-host calls with renderer
lifecycle and cleanup.

## Testing

```bash
bun test packages/next/src/index.test.ts
bun run typecheck
```

## Platform notes

The package has no runtime dependency on `next`. Apps own Next.js and React
versions. The desktop host installs the renderer transport in the client runtime.

## Internal architecture

The package re-exports a Next-shaped facade over `ReactDesktop.from(manifest)`.
It does not create a second client model; all RPC descriptors, support metadata,
transport wiring, and scope cleanup come from the React adapter and core renderer
RPC runtime.

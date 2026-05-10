# @effect-desktop/next

Next.js integration for app-scoped Effect Desktop RPC clients.

The package is a client-component entry point over `@effect-desktop/react`. It intentionally does not expose server-component APIs: renderer desktop RPCs belong in files with a client boundary, and server code should keep using normal Effect services.

This package has no runtime dependency on `next`; the `"use client"` entry point is the integration boundary, and the app owns its Next.js version.

```tsx
"use client"

import { Desktop as DesktopCore } from "@effect-desktop/core"
import { NextDesktop } from "@effect-desktop/next"
import { App, NotesRpcs } from "../desktop/app"

export const Desktop = NextDesktop.from(DesktopCore.manifest(App))

export function NotesProviders(props: { children: React.ReactNode }) {
  return Desktop.createRoot(props.children)
}

export function NotesList() {
  const notes = Desktop.useDesktop(NotesRpcs)
  const list = notes.list.createQuery()
  return null
}
```

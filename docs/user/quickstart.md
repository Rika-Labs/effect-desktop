# Quickstart

Start with the basic React Tailwind template and keep native calls behind imported RPC groups.

## From this repository

```bash
bun install --frozen-lockfile
cd templates/basic-react-tailwind
bun run dev
```

The current development loop uses Vite. `desktop dev` is not implemented yet.

## Runnable Example

```ts run
import { ReactDesktop } from "../packages/react/src/index.js"
import { WindowRpcs } from "../packages/native/src/index.js"

if (typeof ReactDesktop.from !== "function" || WindowRpcs === undefined) {
  throw new Error("React desktop RPC helpers are unavailable")
}
```

## First renderer action

```tsx
import { Desktop } from "@effect-desktop/core"
import { WindowRpcs } from "@effect-desktop/native"
import { ReactDesktop } from "@effect-desktop/react"
import { App } from "./desktop"

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

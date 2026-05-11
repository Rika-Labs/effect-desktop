# Quickstart

Start with the basic React Tailwind template and keep native calls behind the React desktop client.

## From this repository

```bash
bun install --frozen-lockfile
cd templates/basic-react-tailwind
bun run dev
```

The current development loop uses Vite. `desktop dev` is not implemented yet.

## First renderer action

```tsx
import { defineDesktopApi, useDesktopClient } from "@effect-desktop/react"

export function Toolbar() {
  const desktop = useDesktopClient()
  const windowApi = defineDesktopApi(desktop.window)
  const createWindow = windowApi.create.useAction()

  return (
    <button
      disabled={createWindow.status === "running"}
      onClick={() => createWindow.run({ title: "Notes", width: 960, height: 640 })}
    >
      Open
    </button>
  )
}
```

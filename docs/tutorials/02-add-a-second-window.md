---
title: "Tutorial 02 — Add a second window"
description: Open, close, restore, and coordinate state across windows.
kind: tutorial
audience: app-developers
effect_version: 4
---

# Tutorial 02 — Add a second window

You built a notes app in [Tutorial 01](01-build-a-notes-app.md). Now you'll add a second "compose" window so users can write a note in a dedicated space without losing their list view. Along the way you'll learn:

- How to declare and open additional windows.
- How `WindowState` persists per-window geometry across launches.
- How two windows share runtime state (they share a `Settings` store, not their UI state).
- How to close and restore windows cleanly through scopes.

> **Prerequisites:** you completed [Tutorial 01](01-build-a-notes-app.md). The notes app from there is what we extend.

## The mental model: windows are scoped resources

Each window the app opens is a scoped resource. The scope is named from the host window id and owns:

- The window's geometry (persisted by `WindowState`).
- Any per-window services or watchers.
- A region of the runtime graph that closes when the window closes.

Two windows in the same app share global services — `Settings`, `Secrets`, `Telemetry` — but not their per-window scopes. State that should "follow the user across windows" goes through a shared service. State that "only matters while this window is open" goes through the window's own scope.

## Step 1 — Declare both windows in the manifest

Update your `Desktop.make` call to declare two windows:

```ts
import { Desktop } from "@orika/core"
import { Native } from "@orika/native"
import { NotesRpcs } from "./notes/contracts.js"
import { NotesHandlersLive } from "./notes/handlers.js"

export const App = Desktop.make({
  id: "dev.example.notes",
  windows: Desktop.windows(
    Desktop.window("main", { title: "Notes", width: 720, height: 520 }),
    Desktop.window("compose", {
      title: "Compose Note",
      width: 480,
      height: 360,
      renderer: "/compose"
    })
  ),
  native: Desktop.native(Native.Window),
  rpcs: Desktop.rpc(NotesRpcs, NotesHandlersLive)
})

export const Manifest = Desktop.manifest(App)
```

Each `Desktop.window(id, spec)` returns a `Layer` that self-registers the window with the framework. Compose multiple windows with `Desktop.windows(...)`. The window ids (`"main"`, `"compose"`) are what runtime services use to scope declarations; renderer view selection uses the renderer route. The `compose` window is declared so the runtime knows about it; we'll open it on demand from the renderer rather than at launch.

If your renderer owns a separate manifest value, include
`WindowRendererRpcs` from `@orika/native/renderer` there. Keep `WindowRpcs` from
`@orika/native` on the runtime side.

### Optional: bind window-scoped resources

`Desktop.window` accepts a third argument — a `Layer` whose lifetime is bound to that window's scope. Anything it acquires (a `Settings` store, a watcher, a stream subscription) is released when the window closes. Use this when you have state that "only matters while this window is open" but needs to live in a service rather than React local state:

```ts
Desktop.window(
  "compose",
  { title: "Compose Note" },
  Settings.window({
    path: "compose-drafts.sqlite",
    schemaVersion: 1
  })
)
```

Inside that window's scoped services, `yield* Settings` gives the compose window's store. The framework provides the current `WindowContext` and window `ResourceOwner` before building the layer, so `Settings.window(...)` can bind ownership to the actual host window scope.

```ts
const ComposeDraftsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const drafts = yield* Settings
    yield* registerDraftStore(drafts)
  })
).pipe(
  Layer.provide(
    Settings.window({
      path: "compose-drafts.sqlite",
      schemaVersion: 1
    })
  )
)
```

You don't write a finalizer; the framework owns the per-window scope.

## Step 2 — Open the compose window from a button

In your `NotesPanel.tsx`, replace the inline textarea with a button that opens a compose window. Add the React import:

```tsx
import { useCreateWindowMutation } from "@orika/react"
```

Inside the component:

```tsx
const createWindow = useCreateWindowMutation()

const onOpenCompose = () => createWindow.run({ title: "Compose Note", renderer: "/compose" })
```

And in the JSX:

```tsx
<button type="button" onClick={onOpenCompose}>
  New note
</button>
```

`useCreateWindowMutation` is the React adapter's wrapper over the `Window.create` RPC. It runs through the same permission and resource pipeline as any other RPC; the renderer doesn't get to construct windows directly.

## Step 3 — Build the compose UI

The compose window needs its own renderer entry. In `apps/inspector/src/notes/ComposePanel.tsx`:

```tsx
import { useState } from "react"
import { Exit } from "effect"
import { ReactDesktop, useCloseCurrentWindowMutation } from "@orika/react"
import { Manifest } from "../manifest.js"
import { NotesRpcs } from "./contracts.js"

const DesktopApp = ReactDesktop.from(Manifest)

export function ComposePanel() {
  const notes = DesktopApp.useDesktop(NotesRpcs)
  const save = notes.save.useMutation()
  const closeWindow = useCloseCurrentWindowMutation()
  const [draft, setDraft] = useState("")

  const onSave = async () => {
    if (!draft.trim()) return
    const saveExit = await save.runPromise({ id: crypto.randomUUID(), body: draft })
    if (Exit.isFailure(saveExit)) return
    await closeWindow.runPromise()
  }

  return (
    <section>
      <h2>New note</h2>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Write…"
        autoFocus
      />
      <div>
        <button type="button" onClick={() => closeWindow.run()}>
          Cancel
        </button>
        <button type="submit" onClick={onSave} disabled={save.status === "running"}>
          {save.status === "running" ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  )
}
```

`useCloseCurrentWindowMutation` calls `Window.close` for the window the renderer is mounted in. When the close fires, the framework:

1. Tells the host to destroy the native window.
2. Closes the window's runtime scope, releasing anything it owned.
3. Persists the window's geometry through `WindowState` if the app declared one.
4. Emits the `permission/use` audit event for the close call.

You did not write any of that.

## Step 4 — Route between windows

How the renderer decides which panel to render is up to your renderer setup. The simplest pattern: open the compose window on `/compose` and branch on the route. `useCurrentWindowId()` returns the host window resource id for native operations, not the `Desktop.window(...)` declaration id.

```tsx
export function App() {
  return window.location.pathname === "/compose" ? <ComposePanel /> : <NotesPanel />
}
```

Same React entry point, different renderer route, different panel. If your app already has a router, use its current route instead of reading `window.location` directly.

## Step 5 — Persist window geometry

`WindowState` is the runtime service that saves window position and size when a window closes and restores them on next launch. Wire it into your app's runtime layer to opt in. The service exposes:

- `WindowState.window(...)` — binds the service to the current `Desktop.window(...)` context.
- `WindowState.persist(state)` — write atomically for the current window when geometry changes.
- `WindowState.restore()` — read the current window's last state on next open.
- Snap to the primary display if the stored rectangle is off every configured display.
- Rename a corrupt state file to `window-state.corrupt.<timestamp>.json` and continue with defaults.

A small handler wrapper around `Window.create` that builds `WindowState.window(...)` for the window, calls `restore` before opening, then subscribes to size/position changes and calls `persist`, gives you the full feature. See [`WindowState` reference](../reference/services/window-state.md).

## Step 6 — Test it

```bash
cd apps/inspector
bun run dev
```

Open the main window. Click "New note" — the compose window opens. Type something, click Save. The compose window closes; the note appears in the main list. Drag the compose window to a new position, close it, reopen it — it returns to where you left it.

## Where state lives

Two questions to ask when adding cross-window functionality:

| Question                                                 | Answer                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| Should this state survive the app exiting?               | Put it in `Settings` or `SqlClient`.                             |
| Should this state survive only while the window is open? | Per-window React state (`useState`, atoms scoped to the window). |
| Should this state be visible to multiple windows live?   | Use a `Stream` or atom from a shared service.                    |

The notes themselves live in `Settings`, so both windows see the same list. The draft text in `ComposePanel` lives in React state — only that window cares about it.

## What you didn't write

- A window manager. The framework owns it.
- A scope cleaner. Closing the window closes its scope.
- A geometry persister. `WindowState` does it.
- A "find current window" handle. `useCurrentWindowId` does it.
- A permission for window operations. The default declarations cover `Window.create` and `Window.close` for the app's own windows.

## Related

- [Tutorial 01](01-build-a-notes-app.md) — the notes app this extends
- [Resource lifecycle](../explanation/resource-lifecycle.md) — why scopes own windows
- Reference: [Window service](../reference/native/window.md), [`WindowState`](../reference/services/window-state.md), [React windows](../reference/react/windows.md)
- How-to: [Add a window](../how-to/add-a-window.md)

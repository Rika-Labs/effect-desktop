# ADR-0023: Cross-Framework Notes Examples

## Status

Accepted

## Context

The framework now exposes app-scoped frontend adapters from a `Desktop.manifest(App)` generated from `Desktop.make(...).pipe(Desktop.provide(Desktop.Rpcs.layer(...)))`. The API is intentionally Effect-first at the boundary, but developers coming from React, Vue, Solid, Next.js, Astro, and Electron need concrete examples that show where the Effect contract lives and where framework-native state lives.

Without examples, each framework user has to rediscover the same boundary: the app owns one `RpcGroup`, each adapter consumes that same group, and the renderer receives a transport from the desktop host. That uncertainty pushes developers back toward Electron-style ad hoc IPC.

## Decision

Add a first-party Notes example suite under `apps/examples`:

- `notes-common` owns the renderer-safe `NotesRpcs` `RpcGroup`, the `NotesApp` manifest, the host-only service layer, seed state, and `RpcTest` demo layers.
- `notes-react` uses React hooks from `ReactDesktop.from(NotesManifest)`.
- `notes-vue` uses Vue composables and refs from `VueDesktop.from(NotesManifest)`.
- `notes-solid` uses Solid signals and primitives from `SolidDesktop.from(NotesManifest)`.
- `notes-next` keeps RPC hooks inside a client component using `NextDesktop.from(NotesManifest)`.
- `notes-astro` keeps `.astro` files as page shells and hydrates a React island declared through `AstroDesktop.from(NotesManifest).island(...)`.

Expose a renderer-safe `@effect-desktop/core/renderer` subpath so frontend adapters and browser examples do not pull host-only Bun modules through the core package barrel. RPC group metadata lives in a small shared runtime module so both the host manifest and renderer descriptors can read the same `RpcGroup` without coupling renderer code to desktop startup code.

The examples are intentionally Apple Notes-style but brand-neutral. They exercise startup load, create, save, delete, selection, and editor state through the shared RPC boundary.

## Alternatives considered

Single React-only example: cheaper, but it would not validate that the adapter abstractions map cleanly onto Vue, Solid, Next, and Astro.

Separate contracts per framework: easier to author locally, but it hides the central framework promise that one Effect `RpcGroup` drives every renderer.

Astro hooks directly in `.astro`: rejected because Astro pages are not hook hosts. Hydrated islands are the correct framework boundary.

## Consequences

The example workspace adds framework-demo dependencies: `vite-plugin-solid`, `astro`, `@astrojs/react`, and `@astrojs/check`. These dependencies are scoped to example apps and do not become runtime dependencies of the framework packages.

The shared demo layers exist only for browser verification. Production desktop applications receive the real host transport.

The Next.js example uses webpack-backed `next dev` and `next build` scripts because Next 16's Turbopack path does not currently consume this workspace TypeScript package graph with NodeNext source imports reliably.

## Validation

Each example must typecheck and run on its assigned local port. The visual verification path opens each local app and confirms notes load, note creation works, editing can be saved, and deletion updates the selected note.

## Migration notes

No existing application code migrates. Future examples should import `NotesRpcs`-style shared contracts instead of redefining RPC groups inside renderer packages.

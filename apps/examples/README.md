# Effect Desktop Examples

These examples use one shared Effect Desktop Notes application contract from `apps/examples/notes-common` and render it through each frontend adapter.

| Example | Command                                       | Port | Adapter shape                                             |
| ------- | --------------------------------------------- | ---: | --------------------------------------------------------- |
| React   | `bun --cwd apps/examples/notes-react run dev` | 5210 | `NotesReact.useDesktop(NotesRpcs)` hooks                  |
| Vue     | `bun --cwd apps/examples/notes-vue run dev`   | 5211 | `NotesVue.useDesktop(NotesRpcs)` composables and refs     |
| Solid   | `bun --cwd apps/examples/notes-solid run dev` | 5212 | `NotesSolid.useDesktop(NotesRpcs)` signals and primitives |
| Next    | `bun --cwd apps/examples/notes-next run dev`  | 5213 | client component using `NextDesktop.from(...)`            |
| Astro   | `bun --cwd apps/examples/notes-astro run dev` | 5214 | `.astro` page shell hydrating a React island directly     |

The examples install `makeNotesDemoRpcLayers()` so they run in a browser during development without fake host transports. A packaged desktop host supplies the real renderer transport.

The Next.js example uses webpack-backed `next dev` and `next build` scripts. Next 16's Turbopack path currently does not consume these workspace TypeScript packages with their NodeNext source imports reliably, so the example pins the working compiler path instead of hiding that boundary from users.

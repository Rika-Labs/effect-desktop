# Notes React

React renderer example for the shared Notes desktop app.

```tsx
const notes = NotesReact.useDesktop(NotesRpcs)
const load = notes.load.useQuery()
const create = notes.create.useMutation()
```

The browser example installs `makeNotesDemoTransport()` so it can be run with Vite. A hosted desktop app supplies the real transport at runtime.

```bash
bun --cwd apps/examples/notes-react run dev
```

# Notes Solid

Solid renderer example for the shared Notes desktop app.

```tsx
const notes = NotesSolid.useDesktop(NotesRpcs)
const load = notes.load.createQuery()
const create = notes.create.createMutation()
```

```bash
bun --cwd apps/examples/notes-solid run dev
```

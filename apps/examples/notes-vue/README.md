# Notes Vue

Vue renderer example for the shared Notes desktop app.

```ts
const notes = NotesVue.useDesktop(NotesRpcs)
const load = notes.load.useQuery()
const create = notes.create.useMutation()
```

The example uses Vue composables and refs without single-file component tooling, keeping the adapter dependency surface minimal.

```bash
bun --cwd apps/examples/notes-vue run dev
```

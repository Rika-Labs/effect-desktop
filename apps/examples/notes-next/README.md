# Notes Next

Next.js renderer example for the shared Notes desktop app.

```tsx
"use client"

const notes = NotesNext.useDesktop(NotesRpcs)
const load = notes.load.useQuery()
```

The desktop RPC hooks stay in `app/NotesClient.tsx`; server components only frame the page.

```bash
bun --cwd apps/examples/notes-next run dev
```

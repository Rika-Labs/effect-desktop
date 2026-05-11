import { AstroDesktop } from "@effect-desktop/astro"
import { NotesManifest, makeNotesDemoTransport } from "@effect-desktop/example-notes-common"
import { ReactDesktop } from "@effect-desktop/react/desktop"

export const NotesReact = ReactDesktop.from(NotesManifest)
export const NotesAstroIsland = AstroDesktop.from(NotesManifest).island(NotesReact, {
  directive: "only",
  renderer: "react"
})
export const notesTransport = makeNotesDemoTransport()

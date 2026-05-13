import { NotesManifest, makeNotesDemoRpcLayers } from "@effect-desktop/example-notes-common"
import { SolidDesktop } from "@effect-desktop/solid"

export const NotesSolid = SolidDesktop.from(NotesManifest)
export const notesRpcLayers = makeNotesDemoRpcLayers()

import { NotesManifest, makeNotesDemoRpcLayers } from "@effect-desktop/example-notes-common"
import { NextDesktop } from "@effect-desktop/next"

export const NotesNext = NextDesktop.from(NotesManifest)
export const notesRpcLayers = makeNotesDemoRpcLayers()

import { Desktop } from "@effect-desktop/core"

import { NotesRpcs, makeNotesRpcsLayer } from "./index.js"

export const NotesApp = Desktop.make({
  id: "notes-example",
  windows: {
    main: {
      title: "Notes",
      width: 1120,
      height: 760,
      renderer: "/"
    }
  },
  rpcs: [Desktop.Rpcs.layer(NotesRpcs, makeNotesRpcsLayer())]
})

export const NotesLayer = Desktop.app(NotesApp)

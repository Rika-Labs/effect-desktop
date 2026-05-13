import { Desktop } from "@effect-desktop/core"

import { makeNotesDesktopRpcLayer } from "./index.js"

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
  rpcs: [makeNotesDesktopRpcLayer()]
})

export const NotesLayer = Desktop.app(NotesApp)

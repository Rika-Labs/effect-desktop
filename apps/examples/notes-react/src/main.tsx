import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App.js"
import { NotesReact, notesTransport } from "./desktop.js"
import "./styles.css"

const root = document.querySelector("#root")

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <NotesReact.DesktopRoot transport={notesTransport}>
        <App />
      </NotesReact.DesktopRoot>
    </StrictMode>
  )
}

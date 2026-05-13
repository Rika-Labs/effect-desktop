import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App.js"
import { NotesReact, notesRpcLayers } from "./desktop.js"
import "./styles.css"

const root = document.querySelector("#root")

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <NotesReact.DesktopRoot rpcLayers={notesRpcLayers}>
        <App />
      </NotesReact.DesktopRoot>
    </StrictMode>
  )
}

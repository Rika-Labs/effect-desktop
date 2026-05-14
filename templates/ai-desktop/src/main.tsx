import { DesktopProvider } from "@effect-desktop/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App.js"
import "./styles.css"

const root = document.querySelector("#root")

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <DesktopProvider>
        <App />
      </DesktopProvider>
    </StrictMode>
  )
}

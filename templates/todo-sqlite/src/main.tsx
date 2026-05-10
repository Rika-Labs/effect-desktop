import { makeHostProtocolInvalidStateError, type HostProtocolError } from "@effect-desktop/bridge"
import type { WindowCreateOptions, WindowHandle } from "@effect-desktop/native"
import {
  DesktopProvider,
  type DesktopClient,
  type DesktopWindowClient
} from "@effect-desktop/react"
import { Effect } from "effect"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App.js"
import "./styles.css"

const unavailableWindow: DesktopWindowClient = Object.freeze({
  create: (_input?: WindowCreateOptions) =>
    unavailable<WindowHandle>("Window.create", "missing host bridge"),
  setTitle: (_window: WindowHandle, _title: string) =>
    unavailable<void>("Window.setTitle", "missing host bridge"),
  close: (_window: WindowHandle) => unavailable<void>("Window.close", "missing host bridge")
})

const desktopClient: DesktopClient = Object.freeze({
  Window: unavailableWindow
})

const root = document.querySelector("#root")

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <DesktopProvider client={desktopClient}>
        <App />
      </DesktopProvider>
    </StrictMode>
  )
}

function unavailable<A>(
  operation: string,
  message: string
): Effect.Effect<A, HostProtocolError, never> {
  return Effect.fail(makeHostProtocolInvalidStateError(message, "call", operation))
}

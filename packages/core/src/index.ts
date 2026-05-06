import { Api, Client, Handlers } from "@effect-desktop/bridge"

export { Api, Client, Handlers } from "@effect-desktop/bridge"
export * from "./runtime/resources.js"
export * from "./runtime/filesystem.js"
export * from "./runtime/process.js"
export * from "./runtime/pty.js"
export * from "./runtime/window-state.js"

export const Desktop = Object.freeze({
  Api,
  Client,
  Handlers
})

import { Api, Client, Handlers } from "@effect-desktop/bridge"

export { Api, Client, Handlers } from "@effect-desktop/bridge"
export * from "./runtime/resources.js"
export * from "./runtime/filesystem.js"
export * from "./runtime/event-log.js"
export * from "./runtime/process.js"
export * from "./runtime/pty.js"
export * from "./runtime/secrets.js"
export * from "./runtime/settings.js"
export * from "./runtime/sqlite.js"
export * from "./runtime/transport.js"
export * from "./runtime/window-state.js"

export const Desktop = Object.freeze({
  Api,
  Client,
  Handlers
})

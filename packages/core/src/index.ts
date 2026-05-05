import { Api, Client, Handlers } from "@effect-desktop/bridge"

export { Api, Client, Handlers } from "@effect-desktop/bridge"
export * from "./runtime/resources.js"

export const Desktop = Object.freeze({
  Api,
  Client,
  Handlers
})

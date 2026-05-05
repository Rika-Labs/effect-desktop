#!/usr/bin/env bun
import {
  HOST_PROTOCOL_VERSION,
  makeHostHandshakeClient,
  makeHostWindowClient,
  negotiateHostVersion
} from "@effect-desktop/bridge"
import { Effect } from "effect"

import packageJson from "../../package.json" with { type: "json" }
import { createHostProtocolExchange } from "./host-client.js"
import { createBunStdioTransport } from "./transport.js"

const readyEvent = {
  event: "runtime.ready",
  version: packageJson.version
} as const
const WINDOW_SMOKE_TEST_ENV = "EFFECT_DESKTOP_WINDOW_SMOKE_TEST"

await Bun.write(Bun.stdout, `${JSON.stringify(readyEvent)}\n`)

const hostExchange = createHostProtocolExchange(createBunStdioTransport())
const handshake = makeHostHandshakeClient(hostExchange)
const windows = makeHostWindowClient(hostExchange)

await Effect.runPromise(
  Effect.gen(function* () {
    yield* negotiateHostVersion(handshake, HOST_PROTOCOL_VERSION)
    yield* handshake.ping()
    const window = yield* windows.create()
    if (process.env[WINDOW_SMOKE_TEST_ENV] === "1") {
      yield* windows.destroy(window.windowId)
    }
  })
)

// The Phase 3 runtime entry is still a smoke binary; later issues replace this with the service loop.
process.exit(0)

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
import { layerStdioSocket, writeStdout } from "./stdio-socket.js"
import { makeTransport } from "./transport.js"
import {
  openDeclaredWindows,
  requireStartupWindows,
  readStartupEnvironment,
  readStartupWindows
} from "./window-supervisor.js"

const readyEvent = {
  event: "runtime.ready",
  version: packageJson.version
} as const

await Effect.runPromise(
  Effect.gen(function* () {
    yield* writeStdout(`${JSON.stringify(readyEvent)}\n`)

    const transport = yield* makeTransport()
    const connection = yield* transport.connect({ target: "stdio" })
    const hostExchange = createHostProtocolExchange(connection)
    const handshake = makeHostHandshakeClient(hostExchange)
    const windows = makeHostWindowClient(hostExchange)
    const startupEnvironment = yield* readStartupEnvironment()
    const startupWindows = yield* readStartupWindows(startupEnvironment)
    const declaredRegistrations = yield* requireStartupWindows(startupWindows)
    yield* negotiateHostVersion(handshake, HOST_PROTOCOL_VERSION)
    yield* handshake.ping()
    yield* openDeclaredWindows(windows, declaredRegistrations, {
      smokeTest: startupEnvironment.smokeTest
    })
  }).pipe(Effect.scoped, Effect.provide(layerStdioSocket))
)

process.exit(0)

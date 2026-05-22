#!/usr/bin/env bun
import {
  HOST_PROTOCOL_VERSION,
  makeHostHandshakeClient,
  makeHostWindowClient,
  negotiateHostVersion
} from "@orika/bridge"
import { Effect, ManagedRuntime, Schema } from "effect"

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

const ReadyEvent = Schema.Struct({
  event: Schema.Literal("runtime.ready"),
  version: Schema.String
})

const encodeReadyEvent = Schema.encodeSync(Schema.fromJsonString(ReadyEvent))

const readyEvent = encodeReadyEvent({
  event: "runtime.ready",
  version: packageJson.version
})

const runtime = ManagedRuntime.make(layerStdioSocket)

await runtime.runPromise(
  Effect.gen(function* () {
    yield* writeStdout(`${readyEvent}\n`)

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
    if (!startupEnvironment.smokeTest) {
      return yield* Effect.never
    }
  }).pipe(Effect.scoped)
)

await runtime.dispose()

process.exit(0)

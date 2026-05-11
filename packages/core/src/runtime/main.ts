#!/usr/bin/env bun
import {
  HOST_PROTOCOL_VERSION,
  makeHostHandshakeClient,
  makeHostWindowClient,
  negotiateHostVersion
} from "@effect-desktop/bridge"
import { Config, Effect, Option } from "effect"

import packageJson from "../../package.json" with { type: "json" }
import { createHostProtocolExchange } from "./host-client.js"
import { createBunStdioTransport } from "./transport.js"
import { openDeclaredWindows, readStartupWindows } from "./window-supervisor.js"

const readyEvent = {
  event: "runtime.ready",
  version: packageJson.version
} as const

const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"])

const windowSmokeTest: Config.Config<boolean> = Config.option(
  Config.string("EFFECT_DESKTOP_WINDOW_SMOKE_TEST")
).pipe(
  Config.map(
    Option.match({
      onNone: () => false,
      onSome: (value) => TRUTHY_ENV_VALUES.has(value.trim().toLowerCase())
    })
  )
)

const hostExchange = createHostProtocolExchange(createBunStdioTransport())
const handshake = makeHostHandshakeClient(hostExchange)
const windows = makeHostWindowClient(hostExchange)
const smokeTestWindows = Object.freeze({
  smoke: Object.freeze({
    title: "Effect Desktop"
  })
})

await Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.tryPromise(() => Bun.write(Bun.stdout, `${JSON.stringify(readyEvent)}\n`))

    const isSmokeTest = yield* windowSmokeTest
    const startupWindows = yield* readStartupWindows(process.env)
    const declaredWindows =
      Object.keys(startupWindows).length === 0 ? smokeTestWindows : startupWindows
    yield* negotiateHostVersion(handshake, HOST_PROTOCOL_VERSION)
    yield* handshake.ping()
    yield* openDeclaredWindows(windows, declaredWindows, { smokeTest: isSmokeTest })
  })
)

process.exit(0)

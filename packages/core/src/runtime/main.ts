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

await Bun.write(Bun.stdout, `${JSON.stringify(readyEvent)}\n`)

const hostExchange = createHostProtocolExchange(createBunStdioTransport())
const handshake = makeHostHandshakeClient(hostExchange)
const windows = makeHostWindowClient(hostExchange)

await Effect.runPromise(
  Effect.gen(function* () {
    const isSmokeTest = yield* windowSmokeTest
    yield* negotiateHostVersion(handshake, HOST_PROTOCOL_VERSION)
    yield* handshake.ping()
    const window = yield* windows.create()
    if (isSmokeTest) {
      yield* windows.destroy(window.windowId)
      return
    }
  })
)

process.exit(0)

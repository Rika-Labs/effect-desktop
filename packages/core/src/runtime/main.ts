#!/usr/bin/env bun
import {
  HOST_PROTOCOL_VERSION,
  makeHostHandshakeClient,
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

await Bun.write(Bun.stdout, `${JSON.stringify(readyEvent)}\n`)

const handshake = makeHostHandshakeClient(createHostProtocolExchange(createBunStdioTransport()))

await Effect.runPromise(
  Effect.gen(function* () {
    yield* negotiateHostVersion(handshake, HOST_PROTOCOL_VERSION)
    yield* handshake.ping()
  })
)

// The Phase 3 runtime entry is still a smoke binary; later issues replace this with the service loop.
process.exit(0)

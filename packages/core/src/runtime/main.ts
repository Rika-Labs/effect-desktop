#!/usr/bin/env bun
import packageJson from "../../package.json" with { type: "json" }

const readyEvent = {
  event: "runtime.ready",
  version: packageJson.version
} as const

await Bun.write(Bun.stdout, `${JSON.stringify(readyEvent)}\n`)

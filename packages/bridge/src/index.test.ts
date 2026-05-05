import { expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  HostProtocolEnvelope,
  decodeHostProtocolEnvelope,
  encodeHostProtocolEnvelope
} from "./index.js"

const FIXTURE_DIR = fileURLToPath(
  new URL("../../../crates/host-protocol/fixtures", import.meta.url)
)

test("shared host-protocol fixtures decode and encode canonically", async () => {
  const fixtureNames = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()

  expect(fixtureNames).toEqual([
    "cancel.json",
    "error-response.json",
    "event.json",
    "request.json",
    "response.json",
    "stream.json"
  ])

  for (const fixtureName of fixtureNames) {
    const source = (await readFile(join(FIXTURE_DIR, fixtureName), "utf8")).trim()
    const decoded = decodeHostProtocolEnvelope(JSON.parse(source))
    const encoded = encodeHostProtocolEnvelope(decoded)

    expect(JSON.stringify(encoded), fixtureName).toBe(source)
  }
})

test("request envelopes require an id", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "request",
      method: "host.ping",
      timestamp: 1710000000000,
      traceId: "trace-missing"
    })
  ).toThrow()
})

test("stream envelopes require a request or resource target", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "stream",
      timestamp: 1710000000000,
      traceId: "trace-missing"
    })
  ).toThrow()
})

test("cancel envelopes require a request or resource target", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "cancel",
      timestamp: 1710000000000,
      traceId: "trace-missing"
    })
  ).toThrow()
})

test("host protocol error tags are closed", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "response",
      id: "request-2",
      timestamp: 1710000000005,
      traceId: "trace-5",
      error: {
        tag: "NotARealError",
        message: "not real"
      }
    })
  ).toThrow()
})

test("timestamps reject values Rust unsigned integers reject", () => {
  for (const timestamp of [-1, 1.5, Number.NaN]) {
    expect(() =>
      decodeHostProtocolEnvelope({
        kind: "request",
        id: "request-1",
        method: "host.ping",
        timestamp,
        traceId: "trace-invalid-timestamp"
      })
    ).toThrow()
  }
})

test("u32 error fields reject values above Rust u32 max", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "response",
      id: "request-2",
      timestamp: 1710000000005,
      traceId: "trace-invalid-schema",
      error: {
        tag: "SettingsMigrationFailed",
        schemaVersion: 4_294_967_296,
        cause: "version overflow"
      }
    })
  ).toThrow()
})

test("host protocol envelope type accepts decoded fixture values", async () => {
  const source = await readFile(join(FIXTURE_DIR, "request.json"), "utf8")
  const envelope: HostProtocolEnvelope = decodeHostProtocolEnvelope(JSON.parse(source))

  expect(envelope.kind).toBe("request")
})

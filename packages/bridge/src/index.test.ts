import { expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"

import {
  HOST_PROTOCOL_ERROR_SPECS,
  HostProtocolEnvelope,
  HostProtocolError,
  RendererResumeDeniedPayload,
  RendererResumePayload,
  RendererResumedPayload,
  ResumeTicket,
  decodeHostProtocolEnvelope,
  encodeHostProtocolEnvelope,
  hostProtocolErrorRecoverableDefault
} from "./index.js"

const FIXTURE_DIR = fileURLToPath(
  new URL("../../../crates/host-protocol/fixtures", import.meta.url)
)
const StrictParseOptions = { onExcessProperty: "error" } as const
const decodeUnknownHostProtocolError = Schema.decodeUnknownSync(HostProtocolError)
const encodeHostProtocolError = Schema.encodeSync(HostProtocolError)

test("shared host-protocol fixtures decode and encode canonically", async () => {
  const fixtureNames = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json") && name !== "errors.json")
    .sort()

  expect(fixtureNames).toEqual([
    "cancel.json",
    "error-response.json",
    "event.json",
    "renderer-disconnected-event.json",
    "renderer-resume-denied-event.json",
    "renderer-resume-request.json",
    "renderer-resumed-event.json",
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

test("shared host-protocol error fixtures decode and encode canonically", async () => {
  const source = (await readFile(join(FIXTURE_DIR, "errors.json"), "utf8")).trim()
  const decoded = (JSON.parse(source) as ReadonlyArray<unknown>).map((error) =>
    decodeUnknownHostProtocolError(error, StrictParseOptions)
  )
  const encoded = decoded.map((error) => encodeHostProtocolError(error, StrictParseOptions))

  expect(JSON.stringify(encoded)).toBe(source)
  expect(decoded.map((error) => error.tag)).toEqual(
    HOST_PROTOCOL_ERROR_SPECS.map((spec) => spec.tag)
  )

  for (const error of decoded) {
    expect(error.recoverable, error.tag).toBe(hostProtocolErrorRecoverableDefault(error.tag))
  }
})

test("host protocol error recoverable defaults come from specs", () => {
  for (const spec of HOST_PROTOCOL_ERROR_SPECS) {
    expect(hostProtocolErrorRecoverableDefault(spec.tag), spec.tag).toBe(spec.recoverable)
  }
})

test("renderer reconnect payload schemas decode canonical shapes", () => {
  const decodeResumeTicket = Schema.decodeUnknownSync(ResumeTicket)
  const decodeResume = Schema.decodeUnknownSync(RendererResumePayload)
  const decodeResumed = Schema.decodeUnknownSync(RendererResumedPayload)
  const decodeDenied = Schema.decodeUnknownSync(RendererResumeDeniedPayload)

  expect(
    decodeResumeTicket(
      {
        windowId: "window-1",
        originTokenHash: "sha256:origin",
        resumeNonce: "resume-1",
        expiresAt: 1710000030000,
        lastStreamCursors: {
          "stream-1": "42"
        }
      },
      StrictParseOptions
    ).lastStreamCursors
  ).toEqual({ "stream-1": "42" })
  expect(
    decodeResume(
      {
        windowId: "window-1",
        resumeNonce: "resume-1",
        cursors: {
          "stream-1": "42"
        }
      },
      StrictParseOptions
    ).cursors
  ).toEqual({ "stream-1": "42" })
  expect(
    decodeResumed(
      {
        windowId: "window-1",
        replayedStreamIds: ["stream-1"]
      },
      StrictParseOptions
    ).replayedStreamIds
  ).toEqual(["stream-1"])
  expect(
    decodeDenied(
      {
        windowId: "window-1",
        reason: "backfillExhausted",
        message: "reconnect backfill exhausted"
      },
      StrictParseOptions
    ).reason
  ).toBe("backfillExhausted")
})

test("host protocol error type supports Effect catchTag", async () => {
  const error = decodeUnknownHostProtocolError(
    {
      tag: "FileNotFound",
      path: "/tmp/missing.txt",
      message: "FileNotFound sample",
      operation: "fixture.operation",
      recoverable: false
    },
    StrictParseOptions
  )
  const recovered = await Effect.runPromise(
    Effect.fail(error).pipe(
      Effect.catchTag("FileNotFound", (caught) => Effect.succeed(caught.path))
    )
  )

  expect(recovered).toBe("/tmp/missing.txt")
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
        message: "not real",
        operation: "fixture.operation",
        recoverable: false
      }
    })
  ).toThrow()
})

test("host protocol envelopes reject excess top-level fields", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "request",
      id: "request-1",
      method: "host.ping",
      timestamp: 1710000000000,
      traceId: "trace-extra",
      error: {
        tag: "Internal",
        message: "extra",
        operation: "fixture.operation",
        recoverable: false
      }
    })
  ).toThrow()
})

test("host protocol errors reject excess detail fields", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "response",
      id: "request-2",
      timestamp: 1710000000005,
      traceId: "trace-extra-error",
      error: {
        tag: "FileNotFound",
        path: "/tmp/missing.txt",
        message: "FileNotFound sample",
        operation: "fixture.operation",
        recoverable: false,
        unexpected: true
      }
    })
  ).toThrow()
})

test("host protocol error platform values are closed", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "response",
      id: "request-2",
      timestamp: 1710000000005,
      traceId: "trace-invalid-platform",
      error: {
        tag: "FileNotFound",
        path: "/tmp/missing.txt",
        message: "FileNotFound sample",
        operation: "fixture.operation",
        platform: "solaris",
        recoverable: false
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
        cause: "version overflow",
        message: "SettingsMigrationFailed sample",
        operation: "fixture.operation",
        recoverable: false
      }
    })
  ).toThrow()
})

test("host protocol envelope type accepts decoded fixture values", async () => {
  const source = await readFile(join(FIXTURE_DIR, "request.json"), "utf8")
  const envelope: HostProtocolEnvelope = decodeHostProtocolEnvelope(JSON.parse(source))

  expect(envelope.kind).toBe("request")
})

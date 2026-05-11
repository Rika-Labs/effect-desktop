import { expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Option, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"

import packageJson from "../package.json" with { type: "json" }
import {
  HOST_PROTOCOL_ERROR_SPECS,
  HOST_PROTOCOL_VERSION,
  HostProtocolEnvelope,
  HostProtocolError,
  RpcCapability,
  RpcEndpoint,
  RpcSupport,
  RendererResumeDeniedPayload,
  RendererResumePayload,
  RendererResumedPayload,
  ResumeTicket,
  decodeHostProtocolEnvelope,
  encodeHostProtocolEnvelope,
  hostProtocolErrorRecoverableDefault,
  rpcCapability,
  rpcEndpointKind,
  rpcEndpointName,
  rpcSupport,
  makeHostProtocolInvalidOutputError
} from "./index.js"

const FIXTURE_DIR = fileURLToPath(
  new URL("../../../crates/host-protocol/fixtures", import.meta.url)
)
const StrictParseOptions = { onExcessProperty: "error" } as const
const decodeUnknownHostProtocolError = Schema.decodeUnknownSync(HostProtocolError)
const encodeHostProtocolError = Schema.encodeSync(HostProtocolError)

test("host protocol version matches the bridge package version", () => {
  expect(HOST_PROTOCOL_VERSION).toBe(packageJson.version)
})

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

test("host protocol errors reject recoverability values that contradict tag policy", () => {
  const mismatches: ReadonlyArray<unknown> = [
    {
      tag: "FileNotFound",
      path: "/tmp/missing.txt",
      message: "not found",
      operation: "fixture.operation",
      recoverable: true
    },
    {
      tag: "Timeout",
      timeoutMs: 1_000,
      message: "timed out",
      operation: "fixture.operation",
      recoverable: false
    }
  ]

  for (const error of mismatches) {
    expect(() => decodeUnknownHostProtocolError(error, StrictParseOptions)).toThrow()
    expect(() =>
      decodeHostProtocolEnvelope({
        kind: "response",
        id: "request-1",
        timestamp: 1710000000000,
        traceId: "trace-recoverability",
        error
      })
    ).toThrow()
  }
})

test("stream envelopes reject mixed payload and errors", () => {
  const error = makeHostProtocolInvalidOutputError("Project.stream", "bad")
  const streamTargets: ReadonlyArray<unknown> = [
    {
      kind: "stream",
      id: "request-1",
      timestamp: 1710000000000,
      traceId: "trace-mixed-stream",
      payload: { frame: "data" }
    },
    {
      kind: "stream",
      resourceId: "stream-1",
      timestamp: 1710000000000,
      traceId: "trace-mixed-stream",
      error
    },
    {
      kind: "stream",
      id: "request-1",
      resourceId: "stream-1",
      timestamp: 1710000000000,
      traceId: "trace-mixed-stream",
      payload: { frame: "data" },
      error
    },
    {
      kind: "stream",
      resourceId: "stream-1",
      timestamp: 1710000000000,
      traceId: "trace-mixed-stream",
      payload: { frame: "data" },
      error
    }
  ]

  expect(decodeHostProtocolEnvelope(streamTargets[0])).toMatchObject({
    kind: "stream",
    payload: { frame: "data" }
  })
  expect(decodeHostProtocolEnvelope(streamTargets[1])).toMatchObject({
    kind: "stream",
    error
  })
  expect(() => decodeHostProtocolEnvelope(streamTargets[2])).toThrow()
  expect(() => decodeHostProtocolEnvelope(streamTargets[3])).toThrow()
})

test("stream envelopes reject mixed request and resource targets", () => {
  const requestTargeted = {
    kind: "stream",
    id: "request-1",
    timestamp: 1710000000000,
    traceId: "trace-stream-target"
  }
  const resourceTargeted = {
    kind: "stream",
    resourceId: "resource-1",
    timestamp: 1710000000000,
    traceId: "trace-stream-target"
  }

  expect(decodeHostProtocolEnvelope(requestTargeted)).toMatchObject({
    kind: "stream",
    id: "request-1"
  })
  expect(decodeHostProtocolEnvelope(resourceTargeted)).toMatchObject({
    kind: "stream",
    resourceId: "resource-1"
  })
  expect(() =>
    decodeHostProtocolEnvelope({
      ...requestTargeted,
      resourceId: "resource-1"
    })
  ).toThrow()
})

test("cancel envelopes reject mixed request and resource targets", () => {
  const requestTargeted = {
    kind: "cancel",
    id: "request-1",
    timestamp: 1710000000000,
    traceId: "trace-cancel-target"
  }
  const resourceTargeted = {
    kind: "cancel",
    resourceId: "resource-1",
    timestamp: 1710000000000,
    traceId: "trace-cancel-target"
  }

  expect(decodeHostProtocolEnvelope(requestTargeted)).toMatchObject({
    kind: "cancel",
    id: "request-1"
  })
  expect(decodeHostProtocolEnvelope(resourceTargeted)).toMatchObject({
    kind: "cancel",
    resourceId: "resource-1"
  })
  expect(() =>
    decodeHostProtocolEnvelope({
      ...requestTargeted,
      resourceId: "resource-1"
    })
  ).toThrow()
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

test("renderer reconnect payload schemas reject empty identity fields", () => {
  const decodeResumeTicket = Schema.decodeUnknownSync(ResumeTicket)
  const decodeResume = Schema.decodeUnknownSync(RendererResumePayload)
  const decodeResumed = Schema.decodeUnknownSync(RendererResumedPayload)
  const decodeDenied = Schema.decodeUnknownSync(RendererResumeDeniedPayload)

  expect(() =>
    decodeResumeTicket(
      {
        windowId: "",
        originTokenHash: "sha256:origin",
        resumeNonce: "resume-1",
        expiresAt: 1710000030000,
        lastStreamCursors: {
          "stream-1": "42"
        }
      },
      StrictParseOptions
    )
  ).toThrow()
  expect(() =>
    decodeResume(
      {
        windowId: "window-1",
        resumeNonce: "",
        cursors: {
          "stream-1": "42"
        }
      },
      StrictParseOptions
    )
  ).toThrow()
  expect(() =>
    decodeResumed(
      {
        windowId: "",
        replayedStreamIds: ["stream-1"]
      },
      StrictParseOptions
    )
  ).toThrow()
  expect(() =>
    decodeDenied(
      {
        windowId: "",
        reason: "backfillExhausted",
        message: "reconnect backfill exhausted"
      },
      StrictParseOptions
    )
  ).toThrow()
})

test("RpcEndpoint annotates query and mutation intent on Effect RPC contracts", () => {
  const List = Rpc.make("Terminal.List").pipe(RpcEndpoint.query)
  const Create = Rpc.make("Terminal.Create").pipe(RpcEndpoint.mutation)

  expect(rpcEndpointKind(List)).toBe("query")
  expect(rpcEndpointKind(Create)).toBe("mutation")
  expect(rpcEndpointKind(Rpc.make("Terminal.Default"))).toBe("mutation")
})

test("RpcCapability and RpcSupport keep boundary metadata on Effect RPC contracts", () => {
  const Open = Rpc.make("Filesystem.Open").pipe(
    RpcEndpoint.mutation,
    RpcCapability({ kind: "filesystem:read", path: "/notes" }),
    RpcSupport.unsupported("host method is not implemented")
  )
  const capability = rpcCapability(Open)

  expect(Option.isSome(capability)).toBe(true)
  if (Option.isSome(capability)) {
    expect(capability.value).toEqual({ kind: "filesystem:read", path: "/notes" })
  }
  expect(rpcSupport(Open)).toEqual({
    status: "unsupported",
    reason: "host method is not implemented"
  })
  expect(rpcSupport(Rpc.make("Filesystem.Stat"))).toEqual({ status: "supported" })
})

test("rpcEndpointName derives renderer method names from Effect RPC tags", () => {
  expect(rpcEndpointName("Terminal.List")).toBe("list")
  expect(rpcEndpointName("Create")).toBe("create")
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

test("host protocol envelopes reject empty trace IDs", () => {
  const envelopes: ReadonlyArray<unknown> = [
    {
      kind: "request",
      id: "request-1",
      method: "host.ping",
      timestamp: 1710000000000,
      traceId: ""
    },
    {
      kind: "response",
      id: "request-1",
      timestamp: 1710000000001,
      traceId: ""
    },
    {
      kind: "event",
      method: "host.ready",
      timestamp: 1710000000002,
      traceId: ""
    },
    {
      kind: "stream",
      id: "request-1",
      timestamp: 1710000000003,
      traceId: ""
    },
    {
      kind: "cancel",
      id: "request-1",
      timestamp: 1710000000004,
      traceId: ""
    }
  ]

  for (const envelope of envelopes) {
    expect(() => decodeHostProtocolEnvelope(envelope)).toThrow()
  }
})

test("host protocol envelopes reject empty routing fields", () => {
  const envelopes: ReadonlyArray<unknown> = [
    {
      kind: "request",
      id: "request-1",
      method: "",
      timestamp: 1710000000000,
      traceId: "trace-1"
    },
    {
      kind: "event",
      method: "",
      timestamp: 1710000000001,
      traceId: "trace-1"
    },
    {
      kind: "stream",
      resourceId: "",
      timestamp: 1710000000002,
      traceId: "trace-1"
    },
    {
      kind: "cancel",
      resourceId: "",
      timestamp: 1710000000003,
      traceId: "trace-1"
    },
    {
      kind: "request",
      id: "request-1",
      method: "host.ping",
      timestamp: 1710000000004,
      traceId: "trace-1",
      windowId: "",
      originToken: ""
    }
  ]

  for (const envelope of envelopes) {
    expect(() => decodeHostProtocolEnvelope(envelope)).toThrow()
  }
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

test("response envelopes reject mixed payload and error outcomes", () => {
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "response",
      id: "request-2",
      timestamp: 1710000000005,
      traceId: "trace-mixed-response",
      payload: { ok: true },
      error: makeHostProtocolInvalidOutputError("fixture.operation", "bad")
    })
  ).toThrow()

  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "response",
      id: "request-2",
      timestamp: 1710000000005,
      traceId: "trace-success-response",
      payload: { ok: true }
    })
  ).not.toThrow()
  expect(() =>
    decodeHostProtocolEnvelope({
      kind: "response",
      id: "request-2",
      timestamp: 1710000000005,
      traceId: "trace-error-response",
      error: makeHostProtocolInvalidOutputError("fixture.operation", "bad")
    })
  ).not.toThrow()
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

import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"

import {
  HostProtocolInvalidOutputError,
  HostProtocolResponseEnvelope,
  PTY_DISPOSE_METHOD,
  PTY_KILL_METHOD,
  PTY_OPEN_METHOD,
  PTY_READ_METHOD,
  PTY_RESIZE_METHOD,
  PTY_WAIT_METHOD,
  PTY_WRITE_METHOD,
  makeHostPtyClient,
  type HostProtocolRequestEnvelope,
  type HostPtyExchange
} from "./index.js"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

test("host PTY client sends PTY method payloads and decodes read output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostPtyClient(ptyExchange(requests), sequencedOptions())

      const opened = yield* client.open({
        command: "/bin/zsh",
        args: ["-l"],
        rows: 24,
        cols: 80,
        cwd: "/tmp",
        env: { TERM: "xterm-256color" }
      })
      yield* client.write(opened.ptyId, textEncoder.encode("echo ok\n"))
      yield* client.resize(opened.ptyId, { rows: 30, cols: 100 })
      yield* client.kill(opened.ptyId, "SIGTERM")
      const output = yield* client.read(opened.ptyId, 16_384)
      const status = yield* client.wait(opened.ptyId)
      yield* client.dispose(opened.ptyId)

      expect(opened).toMatchObject({ ptyId: "pty-1", pid: 1234 })
      expect(textDecoder.decode(output.bytes)).toBe("native-pty-ok")
      expect(output.done).toBe(false)
      expect(status).toMatchObject({ code: 0 })
      expect(requests.map((request) => request.method)).toEqual([
        PTY_OPEN_METHOD,
        PTY_WRITE_METHOD,
        PTY_RESIZE_METHOD,
        PTY_KILL_METHOD,
        PTY_READ_METHOD,
        PTY_WAIT_METHOD,
        PTY_DISPOSE_METHOD
      ])
      expect(requests[0]?.payload).toEqual({
        command: "/bin/zsh",
        args: ["-l"],
        rows: 24,
        cols: 80,
        cwd: "/tmp",
        env: { TERM: "xterm-256color" }
      })
      expect(requests[1]?.payload).toEqual({
        ptyId: "pty-1",
        bytesBase64: "ZWNobyBvawo="
      })
    })
  ))

test("host PTY client rejects malformed read base64 as invalid host output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeHostPtyClient(malformedReadExchange(), sequencedOptions())

      yield* expectEffectFailure(client.read("pty-1", 16_384), (error) =>
        Schema.is(HostProtocolInvalidOutputError)(error)
      )
    })
  ))

const ptyExchange = (requests: HostProtocolRequestEnvelope[]): HostPtyExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        payload: responsePayload(request.method)
      })
    )
  }
})

const malformedReadExchange = (): HostPtyExchange => ({
  request: (request) =>
    Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        payload: { bytesBase64: "***", done: false }
      })
    )
})

const responsePayload = (method: string): unknown => {
  switch (method) {
    case PTY_OPEN_METHOD:
      return { ptyId: "pty-1", pid: 1234 }
    case PTY_READ_METHOD:
      return { bytesBase64: "bmF0aXZlLXB0eS1vaw==", done: false }
    case PTY_WAIT_METHOD:
      return { code: 0 }
    default:
      return undefined
  }
}

const sequencedOptions = () => {
  let sequence = 0
  return {
    nextRequestId: () => `request-pty-${++sequence}`,
    nextTraceId: () => `trace-pty-${sequence}`,
    now: () => 1710000000000 + sequence
  }
}

class ExpectedFailureMissing extends Schema.TaggedErrorClass<ExpectedFailureMissing>()(
  "ExpectedFailureMissing",
  {}
) {}

const expectEffectFailure = <A, E>(
  effect: Effect.Effect<A, E, never>,
  predicate: (error: unknown) => boolean
): Effect.Effect<void, ExpectedFailureMissing, never> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause.reasons.find(Cause.isFailReason)
      expect(predicate(failure?.error)).toBe(true)
      return
    }
    return yield* new ExpectedFailureMissing()
  })

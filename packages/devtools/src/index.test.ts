import { expect, test } from "bun:test"
import {
  CommandRegistry,
  makeCommandRegistry,
  makePermissionRegistry,
  makeResourceRegistry,
  PermissionActor,
  PermissionContext,
  type NormalizedCapability
} from "@effect-desktop/core"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"

import { CommandsDevtools, CommandsDevtoolsLive } from "./index.js"

const commandCapability: NormalizedCapability = {
  kind: "native.invoke",
  primitive: "Command",
  methods: ["app.file.open"],
  audit: "always"
}

test("CommandsDevtools lists registered commands and observes invocation telemetry", async () => {
  let timestamp = 100
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const commands = await Effect.runPromise(
    makeCommandRegistry(resources, permissions, {
      now: () => timestamp++
    })
  )
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(
    commands.register({
      id: "app.file.open",
      inputSchema: Schema.Struct({ path: Schema.String }),
      outputSchema: Schema.Void,
      capability: commandCapability,
      ownerScope: "app",
      handler: () => Effect.void
    })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const devtools = yield* CommandsDevtools
      const firstList = yield* devtools.list()
      const observed = yield* devtools
        .observeInvocations()
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      yield* commands.invoke(
        "app.file.open",
        { path: "/tmp/project" },
        new PermissionContext({
          actor: new PermissionActor({ kind: "window", id: "window-1" }),
          traceId: "trace-1"
        })
      )
      const events = yield* Fiber.join(observed)
      const finalList = yield* devtools.list()
      return { events: Array.from(events), finalList, firstList }
    }).pipe(
      Effect.provide(Layer.provide(CommandsDevtoolsLive, Layer.succeed(CommandRegistry)(commands)))
    )
  )

  expect(result.firstList.map((command) => command.id)).toEqual(["app.file.open"])
  expect(result.firstList[0]?.invocationCount).toBe(0)
  expect(result.events[0]?.commandId).toBe("app.file.open")
  expect(result.events[0]?.outcome).toBe("success")
  expect(result.events[0]?.traceId).toBe("trace-1")
  expect(result.finalList[0]?.invocationCount).toBe(1)
  expect(result.finalList[0]?.lastInvocation?.outcome).toBe("success")
})

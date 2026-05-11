import { expect, test } from "bun:test"
import { makeDesktopServerProtocol } from "@effect-desktop/bridge"
import { Desktop } from "@effect-desktop/core"
import { Effect, Exit, Layer } from "effect"
import { RpcServer } from "effect/unstable/rpc"

import { NotesManifest, NotesRpcs, makeNotesDemoTransport } from "./index.js"
import { NotesApp, NotesLayer } from "./host.js"

test("NotesApp exposes the canonical Notes RpcGroup through its manifest", () => {
  expect(NotesManifest.id).toBe("notes-example")
  expect(NotesManifest.windows["main"]?.title).toBe("Notes")
  expect(NotesManifest.rpcGroups[0]?.group).toBe(NotesRpcs)
  expect(Desktop.manifest(NotesApp)).toEqual(NotesManifest)
})

test("NotesLayer binds the Notes RpcGroup into the desktop runtime", async () => {
  const transport = makeNotesDemoTransport()
  const protocolLayer = Layer.effect(RpcServer.Protocol)(makeDesktopServerProtocol(transport))
  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(NotesLayer.pipe(Layer.provide(protocolLayer))))
  )

  expect(Exit.isSuccess(exit)).toBe(true)
})

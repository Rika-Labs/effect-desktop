import { expect, test } from "bun:test"
import { Desktop } from "@effect-desktop/core"
import { makeDesktopRendererRpcTestRuntime } from "@effect-desktop/core/renderer"
import { Effect } from "effect"

import { NotesManifest, NotesRpcs, makeNotesDemoRpcLayers } from "./index.js"
import { NotesApp } from "./host.js"

test("NotesApp exposes the canonical Notes RpcGroup through its manifest", () => {
  expect(NotesManifest.id).toBe("notes-example")
  expect(NotesManifest.windows["main"]?.title).toBe("Notes")
  expect(NotesManifest.rpcGroups[0]?.group).toBe(NotesRpcs)
  expect(Desktop.manifest(NotesApp)).toEqual(NotesManifest)
})

test("Notes demo RPC layers execute the Notes RpcGroup through RpcTest", async () => {
  const runtime = makeDesktopRendererRpcTestRuntime(makeNotesDemoRpcLayers())
  const notes = runtime.clients.get(NotesRpcs)

  expect(notes).toBeDefined()
  const load = notes?.["Notes.Load"]
  expect(load).toBeDefined()
  const workspace = await Effect.runPromise(load!(undefined) as Effect.Effect<unknown, unknown>)
  await Effect.runPromise(runtime.dispose())

  expect(workspace).toMatchObject({
    selectedId: "note-001",
    notes: expect.arrayContaining([expect.objectContaining({ id: "note-001" })])
  })
})

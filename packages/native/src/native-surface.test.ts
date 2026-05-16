import { expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { rpcCapability, rpcEndpointKind, rpcSupport } from "@effect-desktop/bridge"
import { P } from "@effect-desktop/core"
import { Option, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"

test("NativeSurface.rpc records native authority, endpoint kind, and support explicitly", () => {
  const rpc = NativeSurface.rpc("Example", "open", {
    payload: Schema.Void,
    success: Schema.Void,
    authority: NativeSurface.authority.native(),
    endpoint: "query",
    support: NativeSurface.support.supported
  })

  expect(rpc._tag).toBe("Example.open")
  expect(rpcEndpointKind(rpc)).toBe("query")
  expect(rpcSupport(rpc)).toEqual({ status: "supported" })
  expect(Option.getOrUndefined(rpcCapability(rpc))).toEqual(
    P.nativeInvoke({ primitive: "Example", methods: ["open"] })
  )
})

test("NativeSurface.rpc records explicit public authority", () => {
  const rpc = NativeSurface.rpc("Example", "isSupported", {
    payload: Schema.Void,
    success: Schema.Void,
    authority: NativeSurface.authority.none,
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })

  expect(Option.getOrUndefined(rpcCapability(rpc))).toEqual({ kind: "none" })
})

test("native service files construct RPCs through NativeSurface", async () => {
  const sourceDir = new URL(".", import.meta.url)
  const sourcePath = fileURLToPath(sourceDir)
  const entries = await readdir(sourceDir)
  const checkedFiles = entries.filter(
    (entry) =>
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      entry !== "desktop-http-api.ts" &&
      entry !== "native-surface.ts"
  )

  const offenders: string[] = []
  for (const entry of checkedFiles) {
    const contents = await readFile(join(sourcePath, entry), "utf8")
    if (contents.includes("Rpc.make(")) {
      offenders.push(entry)
    }
  }

  expect(offenders).toEqual([])
})

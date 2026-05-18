#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { Effect } from "effect"

import {
  makeNativeParityMatrixResult,
  type NativeParityMatrixResultType
} from "../packages/native/src/parity-matrix.js"
import {
  formatNativeParityMatrixMarkdown,
  routedHostMethodsFromSource
} from "../packages/native/src/parity-matrix-source.js"
import { Native } from "../packages/native/src/native.js"

const HOST_PROTOCOL_PATH = "crates/host-protocol/src/lib.rs"
const HOST_ROUTER_PATH = "crates/host/src/methods/mod.rs"
const PARITY_JSON_PATH = "docs/reference/native/parity-matrix.json"
const PARITY_MARKDOWN_PATH = "docs/reference/native/parity-matrix.md"
const CLI_PARITY_JSON_PATH = "packages/cli/src/native-parity-matrix.json"

export const readRoutedHostMethods = async (cwd: string): Promise<ReadonlySet<string>> => {
  const [protocolSource, routerSource] = await Promise.all([
    readFile(join(cwd, HOST_PROTOCOL_PATH), "utf8"),
    readFile(join(cwd, HOST_ROUTER_PATH), "utf8")
  ])
  return routedHostMethodsFromSource(protocolSource, routerSource)
}

export const buildNativeParityMatrix = async (
  cwd: string
): Promise<NativeParityMatrixResultType> => {
  const hostMethods = await readRoutedHostMethods(cwd)
  return Effect.runPromise(makeNativeParityMatrixResult(Native.all.surfaces, hostMethods))
}

export const writeNativeParityMatrixDocs = async (cwd: string): Promise<void> => {
  const matrix = await buildNativeParityMatrix(cwd)
  const json = `${JSON.stringify(matrix, null, 2)}\n`
  await Promise.all([
    writeFile(join(cwd, PARITY_JSON_PATH), json),
    writeFile(join(cwd, CLI_PARITY_JSON_PATH), json),
    writeFile(join(cwd, PARITY_MARKDOWN_PATH), formatNativeParityMatrixMarkdown(matrix))
  ])
}

if (import.meta.main) {
  await writeNativeParityMatrixDocs(join(import.meta.dir, ".."))
}

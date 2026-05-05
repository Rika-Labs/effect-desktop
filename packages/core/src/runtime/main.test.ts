import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import packageJson from "../../package.json" with { type: "json" }

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)))

interface RuntimeReadyEvent {
  readonly event: "runtime.ready"
  readonly version: string
}

const isRuntimeReadyEvent = (value: unknown): value is RuntimeReadyEvent => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const record = value as Record<string, unknown>

  return record["event"] === "runtime.ready" && typeof record["version"] === "string"
}

test("runtime entry emits exactly one ready event", () => {
  const subprocess = Bun.spawnSync(["bun", "src/runtime/main.ts"], {
    cwd: PACKAGE_ROOT,
    stdout: "pipe",
    stderr: "pipe"
  })

  expect(subprocess.exitCode).toBe(0)
  expect(subprocess.stderr.toString("utf8")).toBe("")

  const stdout = subprocess.stdout.toString("utf8")
  const lines = stdout.split("\n")

  expect(lines).toHaveLength(2)

  const [line, trailingLine] = lines
  if (line === undefined) {
    throw new Error("runtime stdout did not contain a ready event line")
  }

  expect(trailingLine).toBe("")

  const parsed: unknown = JSON.parse(line)
  if (!isRuntimeReadyEvent(parsed)) {
    throw new Error(`runtime stdout was not a ready event: ${line}`)
  }

  expect(parsed).toEqual({
    event: "runtime.ready",
    version: packageJson.version
  })
})

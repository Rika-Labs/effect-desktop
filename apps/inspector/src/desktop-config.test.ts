import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Random } from "effect"

import config from "../desktop.config.js"

test("Inspector desktop config declares app-local entries required by desktop build", () => {
  expect(config.renderer.entry).toBe("src/main.tsx")
  expect(config.runtime.entry).toBe("src/runtime/main.ts")
  expect(config.windows.main).toMatchObject({
    title: "ORIKA Inspector",
    width: 1100,
    height: 760,
    route: "/"
  })
})

test("Inspector runtime entry preserves the shared runtime handshake when bundled", () =>
  Effect.runPromise(
    Effect.acquireUseRelease(
      Random.nextUUIDv4.pipe(
        Effect.map((uuid) => join(tmpdir(), `orika-inspector-runtime-${uuid}.js`))
      ),
      (outputPath) =>
        Effect.gen(function* () {
          const proc = Bun.spawn([
            "bun",
            "build",
            fileURLToPath(new URL("runtime/main.ts", import.meta.url)),
            "--target=bun",
            "--outfile",
            outputPath
          ])
          const exitCode = yield* Effect.promise(() => proc.exited)
          expect(exitCode).toBe(0)

          const bundle = yield* Effect.promise(() => Bun.file(outputPath).text())
          expect(bundle).toContain("runtime.ready")
        }),
      (outputPath) => Effect.promise(() => Bun.file(outputPath).delete()).pipe(Effect.ignore)
    )
  ))

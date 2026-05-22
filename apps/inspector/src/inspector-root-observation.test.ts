import { expect, test } from "bun:test"
import { Effect } from "effect"

test("InspectorRoot subscribes to the selected session stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(new URL("./main.tsx", import.meta.url)).text()
      )

      expect(source).toContain("service.observe(selectedSessionId)")
      expect(source).toContain("Stream.runForEach")
      expect(source).toContain("setSnapshot(nextSnapshot)")
      expect(source).toContain("setSelectedSessionId(sessionId)")
      expect(source).toContain("Cause.hasInterruptsOnly")
      expect(source).toContain("interrupt()")
    })
  ))

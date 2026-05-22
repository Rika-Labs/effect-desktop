import { expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"

import {
  ScreenBounds,
  ScreenDisplay,
  ScreenDisplaysChangedEvent,
  ScreenDisplaysResult
} from "./contracts/screen.js"

test("Screen display list payloads require exactly one primary display", () => {
  const invalidDisplayLists = [
    [],
    [
      screenDisplay({
        id: "display-1",
        primary: false
      })
    ],
    [
      screenDisplay({
        id: "display-1",
        primary: true
      }),
      screenDisplay({
        id: "display-2",
        primary: true
      })
    ]
  ] as const

  for (const displays of invalidDisplayLists) {
    const resultExit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(ScreenDisplaysResult)({ displays })
    )
    expect(Exit.isFailure(resultExit)).toBe(true)

    const eventExit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(ScreenDisplaysChangedEvent)({ displays })
    )
    expect(Exit.isFailure(eventExit)).toBe(true)
  }

  const validDisplays = [
    screenDisplay({
      id: "display-1",
      primary: true
    }),
    screenDisplay({
      id: "display-2",
      primary: false
    })
  ] as const

  expect(
    Exit.isSuccess(
      Effect.runSyncExit(
        Schema.decodeUnknownEffect(ScreenDisplaysResult)({ displays: validDisplays })
      )
    )
  ).toBe(true)
  expect(
    Exit.isSuccess(
      Effect.runSyncExit(
        Schema.decodeUnknownEffect(ScreenDisplaysChangedEvent)({ displays: validDisplays })
      )
    )
  ).toBe(true)
})

const screenBounds = new ScreenBounds({ x: 0, y: 0, width: 1920, height: 1080 })

const screenDisplay = ({
  id,
  primary
}: {
  readonly id: string
  readonly primary: boolean
}): ScreenDisplay =>
  new ScreenDisplay({
    id,
    bounds: screenBounds,
    workArea: screenBounds,
    scaleFactor: 2,
    primary
  })

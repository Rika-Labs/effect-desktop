import { expect, test } from "bun:test"

import {
  DevtoolsInvalidOptionError,
  positiveFrameInterval,
  positiveRowLimit
} from "./panel-options.js"

test("positiveFrameInterval rejects malformed millisecond suffixes", () => {
  for (const value of ["16 millisx", "16 millis ", "1e3 millis", "0 millis", "-1 millis"]) {
    expect(() => positiveFrameInterval(value as `${number} millis`, "16 millis")).toThrow(
      DevtoolsInvalidOptionError
    )
  }
  expect(() => positiveFrameInterval("16 millis" as `${number} millis`, "1 millis")).not.toThrow()
  expect(positiveFrameInterval("0.5 millis" as `${number} millis`, "1 millis")).toBe("0.5 millis")
})

test("positiveRowLimit rejects non-positive and fractional row caps", () => {
  expect(() => positiveRowLimit(0, 10)).toThrow(DevtoolsInvalidOptionError)
  expect(() => positiveRowLimit(-1, 10)).toThrow(DevtoolsInvalidOptionError)
  expect(() => positiveRowLimit(1.5, 10)).toThrow(DevtoolsInvalidOptionError)
  expect(positiveRowLimit(1, 10)).toBe(1)
})

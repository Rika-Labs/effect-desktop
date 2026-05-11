import { Data } from "effect"

export class DevtoolsInvalidOptionError extends Data.TaggedError("DevtoolsInvalidOptionError")<{
  readonly option: string
  readonly message: string
}> {}

export const positiveRowLimit = (value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new DevtoolsInvalidOptionError({
      option: "maxRows",
      message: "maxRows must be a positive integer"
    })
  }
  return resolved
}

export const positiveFrameInterval = (
  value: `${number} millis` | undefined,
  fallback: `${number} millis`
): `${number} millis` => {
  const resolved = value ?? fallback
  const millis = Number(resolved.slice(0, -" millis".length))
  if (!Number.isFinite(millis) || millis <= 0) {
    throw new DevtoolsInvalidOptionError({
      option: "frameInterval",
      message: "frameInterval must be a positive millisecond duration"
    })
  }
  return resolved
}

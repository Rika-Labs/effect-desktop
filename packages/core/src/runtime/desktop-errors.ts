import { Data } from "effect"

export type DesktopFramework = "react" | "vue" | "solid" | "next" | "astro" | "unknown"

export class MissingDesktopContextError extends Data.TaggedError(
  "MissingDesktopContextError"
)<{
  readonly framework: DesktopFramework
  readonly message: string
}> {}

export class MissingDesktopRpcClientError extends Data.TaggedError(
  "MissingDesktopRpcClientError"
)<{
  readonly framework: DesktopFramework
  readonly message: string
  readonly tag: string
}> {}

export class MissingDesktopRpcsError extends Data.TaggedError("MissingDesktopRpcsError")<{
  readonly message: string
  readonly tags: readonly string[]
}> {}

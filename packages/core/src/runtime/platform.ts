import { BunServices } from "@effect/platform-bun"

export { FileSystem } from "effect/FileSystem"
export type { FileSystem as FileSystemTag } from "effect/FileSystem"
export { Path } from "effect/Path"
export type { Path as PathTag } from "effect/Path"
export { Terminal } from "effect/Terminal"
export type { Terminal as TerminalTag } from "effect/Terminal"
export { Stdio } from "effect/Stdio"
export type { PlatformError } from "effect/PlatformError"
export { ChildProcessSpawner } from "effect/unstable/process"

export const BunServicesLayer = BunServices.layer

import { spawn } from "node:child_process"
import { resolve } from "node:path"

export interface RuntimeChild {
  readonly pid: number | undefined
  readonly stdin: NodeJS.WritableStream
  readonly stdout: NodeJS.ReadableStream
  readonly kill: () => void
  readonly onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void
}

export interface SpawnRuntimeOptions {
  readonly entry: string
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
}

export const spawnRuntime = (options: SpawnRuntimeOptions): RuntimeChild => {
  const entryPath = resolve(options.cwd, options.entry)

  const child = spawn("bun", ["run", entryPath], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "inherit"]
  })

  return {
    pid: child.pid,
    stdin: child.stdin as NodeJS.WritableStream,
    stdout: child.stdout as NodeJS.ReadableStream,
    kill: () => {
      child.kill("SIGTERM")
    },
    onExit: (cb) => {
      ;(child as unknown as NodeJS.EventEmitter).on("exit", cb)
    }
  }
}

import { resolve } from "node:path"
import type { ViteDevServer } from "vite"
import { spawnRuntime, type RuntimeChild } from "./child-process.js"
import { makeStdioBridge, type StdioBridge } from "./stdio-bridge.js"
import {
  FRAME_DOWN_EVENT,
  FRAME_UP_EVENT,
  RUNTIME_READY_EVENT,
  RUNTIME_RESTART_EVENT
} from "./virtual-module.js"

export interface HmrControllerOptions {
  readonly entry: string
  readonly cwd: string
  readonly server: ViteDevServer
}

export interface HmrController {
  readonly bridge: () => StdioBridge | undefined
  readonly dispose: () => void
}

export const makeHmrController = (options: HmrControllerOptions): HmrController => {
  const { entry, cwd, server } = options
  let child: RuntimeChild | undefined
  let bridge: StdioBridge | undefined
  let disposed = false

  const entryPath = resolve(cwd, entry)

  const start = (): void => {
    if (disposed) return

    child = spawnRuntime({ entry, cwd })
    bridge = makeStdioBridge(child)

    bridge.onFrame((frame) => {
      const b64 = Buffer.from(frame).toString("base64")
      server.ws.send(FRAME_DOWN_EVENT, { data: b64 })
    })

    child.onExit((code, signal) => {
      if (disposed) return
      server.ws.send("effect-desktop:runtime-exit", { code, signal: signal ?? null })
    })

    server.ws.send(RUNTIME_READY_EVENT, {})
  }

  const restart = (): void => {
    bridge?.dispose()
    bridge = undefined
    child = undefined
    start()
    server.ws.send(RUNTIME_RESTART_EVENT, {})
  }

  server.ws.on(FRAME_UP_EVENT, (data: { data: string }) => {
    const bytes = Buffer.from(data.data, "base64")
    bridge?.send(new Uint8Array(bytes))
  })

  server.watcher.on("change", (filePath) => {
    if (filePath === entryPath) {
      restart()
    }
  })

  start()

  return {
    bridge: () => bridge,
    dispose: () => {
      disposed = true
      bridge?.dispose()
      bridge = undefined
      child = undefined
    }
  }
}

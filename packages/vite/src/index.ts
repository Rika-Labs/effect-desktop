import { NodeServices } from "@effect/platform-node"
import { Effect, ManagedRuntime, Path } from "effect"
import type { Plugin, ViteDevServer } from "vite"
import { makeHmrController, type HmrController } from "./hmr-controller.js"
import {
  VIRTUAL_MODULE_ID,
  RESOLVED_VIRTUAL_MODULE_ID,
  buildVirtualModuleSource
} from "./virtual-module.js"

const pathRuntime = ManagedRuntime.make(NodeServices.layer)

export interface DesktopPluginOptions {
  readonly entry: string
}

export default function desktop(options: DesktopPluginOptions): Plugin {
  const { entry } = options

  let hmr: HmrController | undefined
  let cwd = process.cwd()

  const plugin: Plugin = {
    name: "effect-desktop",
    enforce: "pre",

    configResolved(config) {
      cwd = config.root
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID
      }
      return undefined
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        return buildVirtualModuleSource()
      }
      return undefined
    },

    configureServer(server: ViteDevServer) {
      hmr = makeHmrController({
        entry,
        cwd,
        server
      })

      server.httpServer?.once("close", () => {
        hmr?.dispose()
      })
    },

    buildStart() {
      if (this.environment?.name === "client") {
        const id = pathRuntime.runSync(
          Effect.gen(function* () {
            const path = yield* Path.Path
            return path.resolve(cwd, entry)
          })
        )
        this.emitFile({
          type: "chunk",
          id,
          name: "runtime"
        })
      }
    },

    closeBundle() {
      hmr?.dispose()
    }
  }

  return plugin
}

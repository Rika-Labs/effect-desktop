import {
  makeHostPtyClient,
  type HostPtyClient,
  type HostPtyClientOptions,
  type HostPtyExchange
} from "@orika/bridge"
import {
  PtyExitStatus,
  PtyLayer,
  type PtyAdapter,
  type PtyChild,
  type PtyOpenInput,
  type PtyOptions,
  type PtySignalInput
} from "@orika/core"
import { Effect, Option } from "effect"

const DefaultReadBufferBytes = 16_384

export interface NativePtyLayerOptions extends Omit<PtyOptions, "adapter"> {
  readonly exchange: HostPtyExchange
  readonly host?: HostPtyClientOptions
  readonly readBufferBytes?: number
}

export const NativePtyLayer = (options: NativePtyLayerOptions) => {
  const { exchange, host, readBufferBytes, ...ptyOptions } = options
  return PtyLayer({
    ...ptyOptions,
    adapter: makeNativePtyAdapter(makeHostPtyClient(exchange, host), {
      readBufferBytes: readBufferBytes ?? DefaultReadBufferBytes
    })
  })
}

interface NativePtyAdapterOptions {
  readonly readBufferBytes: number
}

const makeNativePtyAdapter = (
  client: HostPtyClient,
  options: NativePtyAdapterOptions
): PtyAdapter => ({
  open: (input) =>
    Effect.gen(function* () {
      const opened = yield* client.open(hostPtyOpenInput(input))
      let running = true
      const ptyId = opened.ptyId
      const lifecycle = makeHostPtyLifecycle(client, ptyId)
      const exited = Effect.runPromise(
        client.wait(ptyId).pipe(
          Effect.map(
            (status) =>
              new PtyExitStatus({
                code: status.code,
                ...(status.signal === undefined ? {} : { signal: status.signal })
              })
          )
        )
      ).finally(() => {
        running = false
        lifecycle.markExited()
      })

      return Object.freeze({
        pid: opened.pid === undefined ? Option.none() : Option.some(opened.pid),
        output: makeOutputStream(client, ptyId, options.readBufferBytes, lifecycle),
        exited,
        write: (chunk) => Effect.runPromise(client.write(ptyId, chunk)),
        resize: (size) => Effect.runPromise(client.resize(ptyId, size)),
        isRunning: () => running,
        terminateTree: () => Effect.runPromise(client.terminateTree(ptyId)),
        forceKillTree: () => Effect.runPromise(client.forceKillTree(ptyId)),
        kill: (signal) => Effect.runPromise(client.kill(ptyId, signal))
      } satisfies PtyChild)
    })
})

const hostPtyOpenInput = (input: PtyOpenInput) => ({
  command: input.command,
  args: input.args,
  rows: input.rows,
  cols: input.cols,
  ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  ...(input.env === undefined ? {} : { env: input.env })
})

interface HostPtyLifecycle {
  readonly markExited: () => void
  readonly markOutputClosed: () => void
}

const makeHostPtyLifecycle = (client: HostPtyClient, ptyId: string): HostPtyLifecycle => {
  let exited = false
  let outputClosed = false
  let disposed = false

  const disposeIfComplete = () => {
    if (disposed || !(exited && outputClosed)) {
      return
    }
    disposed = true
    void Effect.runPromise(client.dispose(ptyId).pipe(Effect.ignore))
  }

  return Object.freeze({
    markExited: () => {
      exited = true
      disposeIfComplete()
    },
    markOutputClosed: () => {
      outputClosed = true
      disposeIfComplete()
    }
  })
}

const makeOutputStream = (
  client: HostPtyClient,
  ptyId: string,
  readBufferBytes: number,
  lifecycle: HostPtyLifecycle
): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await Effect.runPromise(client.read(ptyId, readBufferBytes))
        if (result.done) {
          lifecycle.markOutputClosed()
          controller.close()
          return
        }
        if (result.bytes.byteLength > 0) {
          controller.enqueue(result.bytes)
        }
      } catch (error) {
        lifecycle.markOutputClosed()
        controller.error(error)
      }
    },
    cancel() {
      lifecycle.markOutputClosed()
    }
  })

export type { HostPtyExchange, HostPtyClientOptions, PtySignalInput }

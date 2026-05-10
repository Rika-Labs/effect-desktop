import { Context, Effect } from "effect"

export type MessagePortLike = {
  readonly postMessage: (data: unknown) => void
  readonly onmessage: ((event: { readonly data: unknown }) => void) | null
}

export interface MessagePortProviderApi {
  readonly acquirePort: (windowId: string) => Effect.Effect<MessagePortLike, never, never>
}

export class MessagePortProvider extends Context.Service<
  MessagePortProvider,
  MessagePortProviderApi
>()("effect-desktop/cluster/MessagePortProvider") {}

export const webViewRunnerDesignNote = `
WebViewRunner design (T29 prototype, verdict: not needed for v1).

The cluster runner interface requires:
  ping(address)     — liveness check between runners
  sendLocal(opts)   — deliver to a local entity fiber
  send(opts)        — forward to a remote runner
  notify(opts)      — durable-notify via storage then wake
  notifyLocal(opts) — local variant of notify
  onRunnerUnavailable(address) — mark a runner dead

Assessment from T29 prototype:

A WebViewRunner as a full runner (with shard assignments, entity hosting,
and peer discovery) is the wrong model for single-host desktop.

The renderer is a display client. It does not need to host entities.
It needs to send messages to entities hosted on the Bun side.

Correct production topology (if cluster verdict becomes "go" post-v1):

  Bun host   — SingleRunner.layer({ runnerStorage: "sql" })
               Uses T02 SqlClient for message + runner storage.
               Hosts all Window entities, singletons, and cron.

  Renderer A — SocketRunner.layerClientOnly
               Connects to Bun host cluster server.
               Sends messages, reads replies from storage.
               No shard ownership, no entity hosting.

  Renderer B — SocketRunner.layerClientOnly

Transport: the T05 MessagePort bridge can carry cluster client
messages if the Bun host exposes a WebSocket endpoint for
SocketRunner.layerClientOnly. This does not require a new runner type.

Path to upstream contribution: only if multi-host (cross-machine)
cluster is needed for desktop — e.g., a browser renderer connecting
to a cloud Bun backend. That use case would benefit from a
MessagePortRunner. Out of scope for v1 desktop.
`

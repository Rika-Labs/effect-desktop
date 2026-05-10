# Bridge

The bridge owns request, response, stream, cancellation, redaction, and protocol error boundaries. App code should not construct bridge envelopes directly.

## Boundary model

```txt
React hook -> typed RPC client -> bridge protocol adapter -> Effect handler -> native service
```

Electron applications often expose selected `ipcRenderer` calls through preload scripts. Effect Desktop replaces that manual bridge with typed RPC contracts, structured failures, cancellation, streams, and scoped resource disposal.

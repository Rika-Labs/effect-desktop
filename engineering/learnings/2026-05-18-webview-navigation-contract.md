# WebView navigation contract

Issue: #1350

The WebView navigation surface now declares the missing `stop` command and a typed `getNavigationState` read. The state contract is explicit data: `{ canGoBack, canGoForward, loading }`.

This is a contract-completion slice, not a host implementation slice. WebView navigation RPCs still use `host-adapter-unimplemented` support metadata, and the parity matrix still reports the Rust host routes as missing. That is intentional until the host owns scoped WebView resources and can truthfully execute the commands.

Verification:

- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun test packages/native/src/index.test.ts -t 'WebView'`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts -t 'WebView|NativeCapabilities|NativeParityMatrix'`
- `bun desktop check --api`
- `bun x ultracite check packages/native/src/contracts/webview.ts packages/native/src/webview.ts packages/native/src/index.test.ts docs/reference/native/webview.md`
- `git diff --check`

Architecture-debt sweep: no wrapper removed. `WebView` remains a durable native surface, but it is still ahead of the Rust host implementation. No new wrapper, compatibility shim, or custom DSL was added. Remaining #1350 work is the real host adapter: scoped WebView resource ownership, host protocol/routes, permission/audit behavior, native navigation commands, history state sourced from the host, navigation lifecycle events, Rust tests, docs, and snapshots.

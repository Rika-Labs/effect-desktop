# `crates/host`

`host` is the native shell binary. Phase 1 wires the foundational native dependencies here:

- `wry` owns WebView integration.
- `tao` owns native window/event-loop integration.
- `tracing` and `tracing-subscriber` own structured host startup logs.
- `anyhow` is the temporary binary error boundary until later protocol-specific errors exist.
- `host-protocol` owns the shared envelope, handshake method names, and typed protocol errors used by host dispatch.
- `serde_json` parses the staged `runtime.ready` startup line emitted by the Bun runtime.
- `uuid` mints UUIDv7 `WindowId` values for native windows created through the host protocol.
- `libc` owns POSIX process-group termination and Linux parent-death signal setup for runtime supervision.
- `windows-sys` owns Windows Job Object calls for runtime process-tree cleanup.

## Linux native prerequisites

Linux builds that compile the WRY/TAO WebView stack require GTK 3 and
WebKitGTK 4.1 development packages. Headless smoke validation also requires
Xvfb and `xauth`:

```bash
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev xvfb xauth
```

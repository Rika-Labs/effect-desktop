# `crates/host`

`host` is the native shell binary. Phase 1 wires the foundational native dependencies here:

- `wry` owns WebView integration.
- `tao` owns native window/event-loop integration.
- `tracing` and `tracing-subscriber` own structured host startup logs.
- `anyhow` is the temporary binary error boundary until later protocol-specific errors exist.

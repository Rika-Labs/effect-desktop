# `crates/host`

`host` is the native shell binary. Phase 1 wires the foundational native dependencies here:

- `wry` owns WebView integration.
- `tao` owns native window/event-loop integration.
- `tracing` and `tracing-subscriber` own structured host startup logs.
- `anyhow` is the temporary binary error boundary until later protocol-specific errors exist.

## Linux native prerequisites

Linux builds that compile the WRY/TAO WebView stack require GTK 3 and
WebKitGTK 4.1 development packages:

```bash
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev
```

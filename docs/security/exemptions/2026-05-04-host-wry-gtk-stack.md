# Host WRY/TAO GTK Stack Advisory Exemption

## Status

Accepted for the Phase 1 host dependency skeleton and Tao window-only runtime.

## Scope

This exemption covers the Linux dependency path introduced by `crates/host`:

- `wry 0.55.1`
- `tao 0.35.2`
- GTK/WebKitGTK crates pulled by WRY/TAO default Linux features
- `glib 0.18.5` and `RUSTSEC-2024-0429`
- Tao native window creation through `WindowBuilder`
- Linux X11/Xvfb smoke execution in CI

It does not cover WebView instantiation, renderer loading, IPC, permissions,
navigation, protocol handling, HTML execution, or any long-lived WebView runtime
behavior.

## Rationale

Issue #7 wires the native host binary and dependency graph. Issue #8 creates the
first Tao native window, keeps it empty, and exits on the native close event.
The host still does not instantiate a WebView, load renderer content, register
URL schemes, or expose IPC.

The current WRY/TAO Linux default feature set resolves through GTK 3 and
WebKitGTK crates that pull `glib 0.18.5`. `cargo audit` reports
`RUSTSEC-2024-0429` for that version, patched in `glib >=0.20.0`; the current
WRY/TAO versions available from the cargo index still resolve this GTK stack for
Linux defaults.

Accepting the advisory at this phase is lower risk than replacing the planned
host substrate before any WebView behavior exists. The active runtime exposure
is limited to native window creation plus CI smoke execution under Xvfb. The
risk must be re-reviewed before WebView, renderer IPC, URL scheme handling, HTML
loading, or other privileged host behavior lands.

## Owner

Effect Desktop maintainers.

## Re-review

Re-review by 2026-06-04, or earlier before the first milestone that
instantiates a WebView, enables renderer IPC, registers URL schemes, loads HTML,
or runs long-lived privileged host behavior on Linux.

## Validation

Validated on 2026-05-04 for the dependency skeleton and re-reviewed on
2026-05-05 for the Tao window-only runtime:

- `cargo info wry` reports `wry 0.55.1` with default `os-webview` and `x11`
  Linux features.
- `cargo info tao` reports `tao 0.35.2` with default `x11` and `dbus` features.
- `cargo tree -p host --target all -i glib` shows `glib 0.18.5` pulled through
  `tao 0.35.2` and `wry 0.55.1`.
- `cargo audit --file Cargo.lock --json` reports `RUSTSEC-2024-0429` for
  `glib 0.18.5` with advisory database updated 2026-05-01.
- `cargo run -p host -- --window-smoke-test` opens the Tao window path and exits
  without WebView, IPC, URL scheme, or HTML behavior.
- PR #146 CI runs the window smoke path on Linux under `xvfb-run -a`.

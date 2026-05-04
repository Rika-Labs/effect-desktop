# Host WRY/TAO GTK Stack Advisory Exemption

## Status

Accepted for Phase 1 skeleton only.

## Scope

This exemption covers the Linux dependency path introduced by `crates/host`:

- `wry 0.55.1`
- `tao 0.35.2`
- GTK/WebKitGTK crates pulled by WRY/TAO default Linux features
- `glib 0.18.5` and `RUSTSEC-2024-0429`

It does not cover renderer loading, IPC, permissions, navigation, protocol
handling, or any long-lived WebView runtime behavior.

## Rationale

Issue #7 wires the native host binary and dependency graph but does not create a
window or instantiate a WebView. The binary initializes tracing, emits
`host.started`, and exits.

The current WRY/TAO Linux default feature set resolves through GTK 3 and
WebKitGTK crates that pull `glib 0.18.5`. `cargo audit` reports
`RUSTSEC-2024-0429` for that version, patched in `glib >=0.20.0`; the current
WRY/TAO versions available from the cargo index still resolve this GTK stack for
Linux defaults.

Accepting the advisory at this phase is lower risk than replacing the planned
host substrate before any WebView behavior exists. The risk must be re-reviewed
before privileged host behavior or Linux WebView runtime behavior lands.

## Owner

Effect Desktop maintainers.

## Re-review

Re-review by 2026-06-04, or earlier before the first milestone that creates a
window, instantiates a WebView, enables renderer IPC, or runs long-lived native
host behavior on Linux.

## Validation

Validated on 2026-05-04:

- `cargo info wry` reports `wry 0.55.1` with default `os-webview` and `x11`
  Linux features.
- `cargo info tao` reports `tao 0.35.2` with default `x11` and `dbus` features.
- `cargo tree -p host --target all -i glib` shows `glib 0.18.5` pulled through
  `tao 0.35.2` and `wry 0.55.1`.
- `cargo audit --file Cargo.lock --json` reports `RUSTSEC-2024-0429` for
  `glib 0.18.5` with advisory database updated 2026-05-01.

# App Lifecycle Host Boundary

Issue #1335 still requires real host-backed quit, restart, focus, launch-context, login-item, protocol-registration, single-instance, and lifecycle-event behavior. The safe incremental step was to add the Rust host boundary without changing capability truth.

The host protocol now declares the current App methods and lifecycle event payloads, and the Rust host routes the App methods. Void methods treat omitted or JSON `null` payloads as the existing wire-level void shape and reject non-null payloads; payload-bearing methods decode strict structs and validate the same high-risk boundaries the TypeScript client checks before they fail closed as typed Unsupported errors. Parity is now unsupported and routed.

Guardrail: no process lifecycle, app activation, login item, single-instance lock, metadata, command-line, protocol registration, or lifecycle event behavior is synthesized. These calls still report unsupported until real platform adapters own the side effects and idempotency rules.

Architecture-debt sweep: no wrapper was removed. Debt remains that broad App methods mix metadata, process lifecycle, protocol registration, login items, and launch events in one service. No separate follow-up issue was opened because #1335 already owns the App lifecycle contract; closing #1335 should decide whether that broad surface is intentional or whether lifecycle policy deserves a narrower Effect service backed by the same host protocol.

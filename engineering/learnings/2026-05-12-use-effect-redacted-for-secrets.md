# Use Effect Redacted for Secrets

## Context

Issue #1269 replaced the local `SecretValue` classes and the hand-rolled bridge
redaction string with Effect `Redacted`.

## What Changed

Core `Secrets` and native `SafeStorage` now accept and return
`Redacted.Redacted<Uint8Array>` through the exported `SecretBytes` type. The
duplicate core/native secret wrapper classes were removed. Bridge redaction now
uses an Effect `Redacted` value as the replacement sentinel and preserves
existing redacted values instead of traversing them.

Bridge and crash reporter emission use a separate JSON materialization path
after redaction. That keeps internal redaction Effect-native while preserving
schema-compatible strings for contract errors and host-frame payloads.

The safe-storage host protocol still uses raw `Uint8Array` schemas. Redacted
values are wrapped and unwrapped at the TypeScript service boundary only.

## Lesson

Effect `Redacted` owns the secret value abstraction, but it does not own desktop
byte policy. `Redacted.make(bytes)` keeps the provided byte-array reference, and
`Redacted.wipeUnsafe` removes the registry entry without zeroing that array. The
framework still needs narrow helpers that copy bytes on construction, copy bytes
on unsafe extraction, and fill bytes before wiping.

The same boundary rule applies to diagnostics: Effect `Redacted` is the right
in-process value, but protocol emission cannot send objects with `toJSON`
through the host-frame validator. Redact first, then materialize redacted leaves
to strings only at JSON/protocol boundaries.

That helper layer is acceptable because it owns durable security policy. A class
that only renamed Effect `Redacted` was not.

# Signing entitlements read documented permissions

## Context

macOS signing derived hardened-runtime entitlements from `security.permissions`, while the documented config and template use top-level `permissions`. A signed app could declare `device.camera` and `network.client` and still receive false camera/network entitlements.

## Change

The signer now reads top-level `permissions` first, falls back to the legacy `security.permissions` shape, and validates entries instead of silently ignoring malformed values. The macOS entitlement plist enables camera, microphone, and network client keys from the normalized permission names.

## Lesson

Platform signing must consume the public permission contract. Silent fallback to an undocumented field makes a successful signature look valid while disabling the capability at runtime.

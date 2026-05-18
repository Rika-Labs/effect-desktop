---
title: Window ownership follows host creation semantics
date: 2026-05-18
issue: 1347
---

# Window ownership follows host creation semantics

Tao exposes parent and owner relationships as creation-time window builder policy, not as a portable mutable window operation. The first usable Effect Desktop slice should therefore make ownership explicit on `Window.create` instead of adding a custom modal/ownership DSL above the host.

The native API now accepts `Window.create({ parent })`. The bridge lowers the fresh parent handle to `parentWindowId`, and the Rust host applies the platform primitive when Tao has one: macOS parent `NSWindow`, Windows owned window. Unsupported hosts return a typed `Unsupported` failure when a parent is requested.

Parent close behavior is owned in two places because there are two authoritative lifetimes. The native adapter owns Effect resource scopes and window lifecycle events, so `Window.close(parent)` closes registered children before the parent. The Rust host owns native platform handles, so direct host `Window.destroy(parent)` also removes tracked children before removing the parent. This prevents Windows owned-window semantics from leaving stale child entries in the host registry after the OS destroys owned native windows.

Architecture-debt sweep: no new wrapper over Effect was added. Existing `BridgeRpc`-style bridge contracts remain boundary descriptions that translate native/web protocol payloads; this ticket only added one payload field and one public Schema field. The remaining debt is feature scope, not wrapper shape: dynamic reparenting, modal semantics, owner lookup, platform matrices, and lifecycle events still need explicit Effect-native contracts before issue #1347 can close.

---
title: Native network services
date: 2026-05-19
issue: 1364
---

# Native Network Services

## What Changed

`NativeNetwork` now owns HTTP fetch, upload, WebSocket, localhost URL, support, and event contracts. The public service validates input, permission-checks before client work, registers WebSockets with `ResourceRegistry`, and publishes typed progress/lifecycle events.

The Rust host now routes the methods and rejects malformed payloads before returning typed unsupported. That keeps the boundary explicit without pretending the current host has a portable HTTP/WebSocket transport adapter.

## Why

Network transport needs a different contract from egress policy. `EgressPolicy` answers whether traffic is allowed; `NativeNetwork` represents the transport operation and its lifecycle. Keeping those separate prevents policy receipt logic from becoming a shallow network wrapper.

## Architecture-Debt Sweep

No wrapper was removed. The touched area already had `EgressPolicy` as durable policy/audit behavior, not transport. `NativeNetwork` uses Schema, Layer, Stream, ResourceRegistry, and NativeSurface directly. The remaining debt is the unsupported Rust transport adapter, which is now isolated behind the validation-first host routes.

## Verification

The focused regression test proves permission denial happens before host/client network work. Additional tests cover success, unsupported platform behavior, host failure, malformed input rejection, event ordering, and WebSocket cleanup through explicit close plus owner-scope disposal.

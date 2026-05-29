---
title: Web request interception
date: 2026-05-19
issue: 1363
---

# Web Request Interception

## What Changed

`WebRequest` now owns request and response interception as a profile-scoped native service. It exposes Schema-typed Effect methods for before-request actions, headers-received mutations, listener removal, support checks, and typed lifecycle events.

Interceptors are long-lived resources, so the service registers each handle with `ResourceRegistry` before returning it to callers. Explicit `removeListener` and owner-scope cleanup both release the same native listener path without double cleanup.

## Why

Interception cannot safely live as renderer monkeypatching. The durable contract is profile identity, declared native permission, ordered registration, and observable listener lifetime. Keeping those rules in one Effect service gives tests the same permission, validation, and cleanup path a renderer uses.

## Architecture-Debt Sweep

No wrapper layer was removed in the touched area. `WebRequest` uses the existing NativeSurface, Schema, Layer, Stream, and ResourceRegistry primitives directly. The only bridge-specific code is the small host/client adapter required to cross the native/web boundary while the Rust host lacks a portable WebView request-interception provider.

## Verification

The focused regression test proves the highest-risk behavior: interceptors receive stable order values and emit observable lifecycle events in that order. Additional tests cover permission denial before client work, malformed redirect rejection before client work, unsupported host behavior, host failure, cancellation through owner-scope cleanup, and single cleanup of explicitly removed listeners.

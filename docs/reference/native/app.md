---
title: App (native)
description: App-level lifecycle and host operations.
kind: reference
audience: app-developers
effect_version: 4
---

# `App`

App-level lifecycle service. The `AppRpcs` group is declared with no methods in the current phase; lifecycle hooks land as the host protocol grows.

## Status

Methods land in a later phase. The contract and types are present so handlers can hook in.

## Related

- Reference: [`Window`](window.md), [`PowerMonitor`](power-monitor.md)
- Source: [`packages/native/src/app.ts`](../../../packages/native/src/app.ts)

---
date: 2026-05-12
type: in-flight-refactor
topic: Expose native capability facts as data
issue: https://github.com/Rika-Labs/effect-desktop/issues/1194
pr: none
---

# Expose native capability facts as data

## Decision

Runtime capability facts should be derived from Effect RPC annotations, not copied into a
second hand-authored table.

## What changed

`@effect-desktop/native` now exports `NativeCapabilities`, a Layer-backed service that
builds a manifest from native `RpcGroup.requests`. `support(tag)` returns the existing
`RpcSupport` metadata for a method such as `Window.show`, and `require(tag)` succeeds for
supported methods or fails with `UnsupportedCapability` for unsupported ones.

The service fails duplicate manifest tags and unknown method lookups as typed values, so
support data cannot silently drift or pretend unknown methods are merely unsupported.

## Why it mattered

Unsupported native operations were already annotated on the RPC descriptors, but app code
had no runtime service for reading those facts. That kept callers choosing between calling
and failing later or hand-maintaining their own support table.

The useful boundary is now one source of truth: `RpcSupport` owns descriptor support,
`DesktopRpc.supportedGroup` owns static supported-only clients, and `NativeCapabilities`
owns runtime support reads.

## Rule candidate

When adding runtime capability APIs, derive them from contract metadata and test duplicate
contract entries as failures.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it.

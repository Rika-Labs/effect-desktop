---
date: 2026-05-12
type: in-flight-refactor
topic: Effect host protocol serialization
issue: https://github.com/Rika-Labs/effect-desktop/issues/1184
pr: none
---

# Effect host protocol serialization

## Decision

Host protocol byte serialization belongs beside the bridge schema contract, not inside the core
host-client exchange loop.

## What changed

`@orika/bridge` now exports host protocol frame codec helpers that encode and parse frame
bytes through Effect Schema JSON transformations and then apply the existing `HostProtocolEnvelope`
schema checks.

`packages/core/src/runtime/host-client.ts` now asks the codec for bytes and parsed values. It still
owns exchange-level behavior: receive a frame, repair missing trace IDs for host compatibility,
decode the repaired envelope, and validate response kind, id, and trace id.

## Why it mattered

The old implementation split one protocol boundary across two packages. Bridge owned the schema
contract, while core owned JSON byte parse/stringify. That made future wire-format changes and
decode error policy easier to fork accidentally.

The useful boundary is now clearer: transport moves bytes, bridge owns host protocol serialization,
and core owns request/response exchange semantics.

## Rule candidate

When a protocol already has a Schema contract, place byte codecs beside that contract and have
runtime clients consume codec effects instead of parsing JSON inline.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it.

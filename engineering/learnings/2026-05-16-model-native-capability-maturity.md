---
date: 2026-05-16
type: feature
topic: Model native capability maturity
issue: https://github.com/Rika-Labs/effect-desktop/issues/1318
pr: none
---

# Model native capability maturity

## Decision

Platform-specific support metadata must have executable check paths and guardrails; otherwise unsupported platform behavior becomes documentation instead of policy.

## What changed

The issue started as a manifest-shape change: replace binary native support with Schema-typed `supported`, `partial`, and `unsupported` metadata. The shipped version keeps that metadata on the existing native surface and bridge descriptor path, adds complete per-platform support entries for partial capabilities, exposes `NativeCapabilities.requirePlatform(tag, platform)` so applications and tests can turn a platform-specific unsupported entry into a typed `UnsupportedCapability`, and aligns production source checks plus generated callable RPC filtering with partial support semantics.

## Why it mattered

The local review found that `require(tag)` correctly failed top-level `unsupported` methods but accepted every `partial` method. A second platform review found stale config guard metadata and missing-platform rows. Those gaps made entries such as "unsupported on Windows" visible in the manifest but not enforceable through the public service or production checks. The invariant is that unsupported behavior must be observable before native work starts; the fix gives platform gaps the same typed failure mechanism as fully unsupported capabilities and makes partial matrices complete.

A final platform review caught a stronger form of the same problem: Dock metadata claimed Linux badge and progress support while the exported Linux client and Rust host still returned unsupported or had no route. The fix moved those rows back to unsupported and added manifest validation that rejects top-level `supported` or `unsupported` values when the platform matrix says otherwise.

## Example

```ts
yield * capabilities.requirePlatform("Dock.setBadgeCount", "windows")
// Fails with UnsupportedCapability when the manifest marks Windows unsupported.
```

## Rule candidate

When adding platform-specific metadata, add one executable API or test path that proves every unsupported platform entry fails as a typed value, and update any production guard source that names the same capability. Why: metadata-only platform matrices make the cheapest future implementation path hide unsupported behavior until host runtime failure.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.

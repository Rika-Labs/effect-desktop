---
date: 2026-05-17
type: in-flight-feature
topic: Implement ExtensionConfig host persistence
issue: https://github.com/Rika-Labs/effect-desktop/issues/1398
pr: none
---

# Implement ExtensionConfig host persistence

## Decision

For native primitives, split TypeScript service tests and Rust method tests are not enough; acceptance needs one proof at the real host protocol boundary.

## What changed

The issue asked for the public `ExtensionConfig` service to preserve validation, permissions, safe-storage ownership, secret projection, audit, redaction, typed errors, and substitutable clients while the Rust host owned durable non-secret persistence, revisions, reset, diagnostics, events, and support reporting.

That architecture shipped, but review exposed two missing mechanisms. The host store first used only a process-local mutex, so two host processes could lose updates; it now uses an OS lock file around load-modify-save and support probing. The first verification pass also proved TypeScript and Rust separately; it now includes a framed runtime test that sends write/read/redact/reset through `serve_framed_host_requests` and observes persisted state plus lifecycle event frames.

## Why it mattered

The invariant was not "the service has tests" or "the host adapter has tests." The invariant was that the shipped native boundary performs the behavior it advertises without leaking secret bytes. Review pressure found that a memory client can make the public API look done while the real host path remains unproven.

## Example

```rust
super::serve_framed_host_requests(Cursor::new(input), &mut output, &test_router())
    .expect("extension config frames should dispatch");

assert_extension_config_event(&frames[0], "written", Some(1));
assert_extension_config_response(
    &frames[3],
    "request-extension-config-read",
    serde_json::json!({
        "extensionId": "extension-1",
        "values": [{ "key": "theme", "value": "dark" }],
        "secrets": [{ "key": "apiKey", "present": true }],
        "revision": 1
    }),
);
```

## Rule candidate

For native capability tickets, require at least one verification at the real host protocol boundary when the acceptance criteria mention the production host path. Why: memory clients and direct method tests can both pass while the actual native boundary remains unproven.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.

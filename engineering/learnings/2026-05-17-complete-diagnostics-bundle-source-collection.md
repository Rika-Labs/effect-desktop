---
date: 2026-05-17
type: in-flight-feature
topic: Complete DiagnosticsBundle source collection
issue: https://github.com/Rika-Labs/effect-desktop/issues/1401
pr: none
---

# Complete DiagnosticsBundle source collection

## Decision

A supported diagnostics exporter must make source coverage explicit in the written artifact: collected sources carry real records, absent sources carry typed unavailable records, and redaction must preserve that source envelope.

## What changed

The issue asked to replace `metadata-only` placeholders with real or explicitly unavailable source records. The Rust host now has a small diagnostics source registry. `host-state` writes process and protocol evidence from the running host, while logs, traces, crash reports, extension health, and audit events write visible `source-unavailable` records until durable stores exist.

Review changed the redaction shape. The first implementation redacted secret values but overwrote the source artifact with the raw redacted payload. The final path wraps redacted payloads back into the same source record structure, so `write` never mixes artifact layout with payload content.

## Why it mattered

The invariant is that the artifact on disk is the support contract. A method can return success while still producing an operationally useless file if missing sources are hidden behind placeholders or if redaction destroys the source envelope.

The architecture-debt sweep found no Effect wrapper debt in the touched area. The Rust registry is host policy because it owns desktop source availability and artifact layout, not a parallel Effect abstraction.

## Example

```json
{
  "source": "logs",
  "status": "unavailable",
  "items": [
    {
      "kind": "source-unavailable",
      "reason": "collector-unavailable",
      "recoverable": false
    }
  ]
}
```

## Rule candidate

Diagnostics redaction must preserve the artifact envelope and replace only sensitive values inside source payloads. Why: secrecy and operator usefulness are separate invariants, and satisfying one by deleting the other turns a supported exporter into a misleading shell.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.

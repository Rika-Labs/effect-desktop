---
date: 2026-05-11
topic: CSP rendering boundaries
issues: [657, 853]
---

# CSP rendering boundaries

CSP rendering has two distinct inputs: directive structure and per-request nonce data. Directive
names must be modeled case-insensitively to match browser parsing, and nonce data must never be
able to introduce new header syntax.

Current directive parsing already normalizes directive names to lowercase; regression tests now pin
mixed-case tightening and duplicate detection. The new change validates nonce tokens before
interpolation, accepting only the framework placeholder or non-empty header-safe token characters.

The durable rule: CSP helpers must model browser semantics for policy structure, while treating
runtime nonce strings as untrusted data until validated.

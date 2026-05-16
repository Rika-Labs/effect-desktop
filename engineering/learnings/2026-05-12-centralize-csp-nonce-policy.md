---
date: 2026-05-12
type: refactor
topic: Centralize CSP and nonce policy
issue: https://github.com/Rika-Labs/effect-desktop/issues/1221
pr: none
---

# Centralize CSP and nonce policy

## Decision

CSP defaults need to be ordered policy data, not copied header strings, because directive order and nonce placeholders are part of the security contract.

## What changed

The issue plan expected a schema-backed policy and adapter-specific rendering. The implementation made `packages/config/src/default-csp-policy.json` the default policy artifact, decoded it into `CspDirective` and `CspPolicy`, had the TypeScript app server render from that policy, and had the Rust host generate its default directives from the same artifact at build time.

The TypeScript app server also stopped using regex nonce injection. It now mints a request nonce from Web Crypto and applies that nonce with Bun `HTMLRewriter`, matching the Rust host's parser-backed boundary. Review also forced the Rust host to load the built `rendererManifest.csp` instead of only rendering generated defaults, so configured policies and disabled CSP are honored at the serving boundary.

## Why it mattered

The non-obvious part is that a CSP header is not just a string. It is a policy graph with browser-specific parsing rules, ordered diagnostics, and a per-request nonce substitution point. Copying the rendered header into each adapter makes the cheapest local change unsafe: an adapter can pass its own tests while drifting from the policy checked by config.

## Example

```ts
export const renderCspPolicy = (
  policy: CspPolicy,
  nonce: string | CspNonce = DEFAULT_CSP_NONCE_PLACEHOLDER
): string =>
  renderCspDirectives(
    policy.directives.map((directive) => [directive.name, directive.values] as const),
    validateCspNonce(typeof nonce === "string" ? nonce : nonce.value)
  )
```

## Rule candidate

Security headers must be represented as typed policy data before rendering. Why: copied header strings hide policy drift until runtime.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it -- `/learn` never auto-edits AGENTS.md.

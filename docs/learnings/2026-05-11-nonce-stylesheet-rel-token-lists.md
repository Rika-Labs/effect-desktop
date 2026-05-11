---
date: 2026-05-11
topic: Stylesheet rel token lists
issues: [830]
---

# Stylesheet rel token lists

HTML `rel` is a token list, but the host CSP rewriter matched only the exact attribute value
`rel="stylesheet"`. A valid stylesheet link such as `rel="preload stylesheet"` could be served
without the nonce required by the response CSP.

The fix matches all links with `rel` and checks for a case-insensitive `stylesheet` token before
adding the nonce. Non-stylesheet preload links remain untouched.

The durable rule: HTML attributes with token-list semantics must be interpreted as token lists, not
as exact strings, when the host enforces security policy.

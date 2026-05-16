---
date: 2026-05-11
topic: Production checker source comments
issues: [619, 658]
---

# Production checker source comments

The production checker matched forbidden renderer tokens against raw source lines. That made warning
comments such as `// do not call sendRaw` indistinguishable from executable raw bridge calls.

The fix keeps the existing rule regexes but moves them behind a shared comment-masking helper that
preserves line and column positions. Executable violations still report the same locations, while
line and block comments no longer create release-gate failures.

The durable rule: source scanners should separate text classification from rule matching. Security
rules stay declarative, but they should run over code regions, not every byte in the file.

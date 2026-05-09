# Review

Locked architecture: keep the containment check private to notarization discovery and make it fail before `statPath` or any command-runner invocation for invalid metadata.

Checks:

- Basename-only validation matches the existing package writer, which emits `basename(artifactPath)`.
- Rejecting `/`, `\`, `..`, `:`, and control bytes covers traversal, nested paths, URL-shaped values, and malformed bytes named in the issue.
- Resolving the root and candidate path gives a second containment check if the lexical validation is changed later.
- The regression asserts zero command invocations, which proves failure ordering rather than only checking exit code.

No public API changes are expected.

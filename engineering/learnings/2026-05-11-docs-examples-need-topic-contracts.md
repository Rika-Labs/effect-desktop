# Docs examples need topic contracts

## Context

The docs gate executed runnable blocks, but required pages could all pass with the same unrelated `CliUsageError` smoke test. A second failure mode let a hanging example block the gate indefinitely.

## Change

Required spec pages now declare expected runnable-example surface tokens in the docs gate. A page fails with `DocsGateCoverageError` when none of its runnable blocks covers the documented API or command surface. Each example runner call is also wrapped in a bounded timeout that returns `DocsGateExampleFailedError`, and the default Bun runner kills the child during cleanup.

The user docs runnable examples were replaced with minimal checks against the package or CLI surface each page describes.

## Lesson

Executable docs are release evidence only when the gate checks both execution and relevance. A runnable block that proves an unrelated symbol exists is worse than no example because it creates false confidence.

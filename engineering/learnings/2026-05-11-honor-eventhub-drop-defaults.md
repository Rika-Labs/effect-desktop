# Honor EventHub Drop Defaults

## Planned

Close #698 by making `backpressure: { strategy: "drop" }` non-blocking even when `overflow` is omitted.

## Shipped

EventHub now resolves event overflow from the declared strategy. Explicit `overflow` values still win; omitted overflow with `strategy: "drop"` defaults to `dropNewest`, while other strategies keep the existing blocking default.

## Review

The regression parks a subscriber behind a one-slot queue, publishes three events, and proves the third publish completes under the concise drop policy. Existing explicit `dropNewest` behavior remains covered.

## Lesson

Shared vocabulary has to mean the same thing at runtime. If `strategy: "drop"` still blocks without a hidden second field, the API contract is misleading.

# Preserve Coalesced Approval IDs

## Planned

Close #671 by keeping approval prompt coalescing while returning caller-specific outcome identities.

## Shipped

Prompt entries now store each waiter's request alongside its deferred. When the shared prompt decision completes, the broker projects that decision onto every waiting request so each caller receives its own `requestId` and trace metadata while prompt count stays coalesced.

## Review

The coalescing test now asserts one host prompt, matching shared decisions, and distinct returned request IDs for `request-1`, `request-2`, and `request-3`. Scope-cache immediate outcomes already used the current request and remain covered.

## Lesson

Coalescing should deduplicate work, not erase caller identity. Keep the shared decision separate from the response envelope delivered to each waiter.

---
date: 2026-05-11
topic: Secret namespace listing order
issues: [663]
---

# Secret namespace listing order

`Secrets.list` filtered storage keys by app id and namespace, but returned them
in the safe-storage adapter's iteration order. That made devtools and UI output
depend on insertion order or platform storage behavior.

The fix sorts the public keys after namespace filtering and before returning to
the caller. The safe-storage port stays simple: it can expose native order, and
the core service owns deterministic API behavior.

The lesson is that adapter order is input, not policy. User-facing list
operations should normalize ordering at the service boundary unless the API
explicitly promises insertion order.

---
date: 2026-05-11
topic: Resource id allocation
issues: [668]
---

# Resource id allocation

The resource registry treated the UUID fallback as guaranteed unique. If the
requested or injected id collided and the first fallback UUID also collided, the
new resource could overwrite a live entry keyed by the same id.

The fix makes allocation total over the current live map. Explicit ids still win
when free, injected ids are still tried next, and fallback UUIDs are generated
until one is absent from the registry. The focused regression stubs UUID
randomness to zeroes, pre-registers the fallback id, then proves the second
registration receives a distinct live id and both resources remain visible.

The lesson is that entropy is not a correctness proof. If the map key defines
ownership, cleanup, and freshness, the allocator must check the map until it has
a unique key.

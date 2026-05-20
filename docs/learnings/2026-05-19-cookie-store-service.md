# Cookie Store Service

Wry 0.55.1 exposes low-level cookie primitives on `WebView`, but the current host does not retain a profile-bound `WebContext` registry. A host-backed cookie store must first bind `SessionProfileHandle` to WebView creation.

The shipped shape is a Schema-typed `CookieStore` over `SessionProfileHandle`, with memory tests proving per-profile partitioning and host routes returning typed `host-cookie-store-unavailable` after strict validation.

Architecture-debt sweep: no `CookieManager` wrapper or cookie DSL was added. `SessionProfileHandle` remains the single partition identity, and `CookieStore` owns only cookie policy, schema, and events.

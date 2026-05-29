# Browsing Data Controls

Wry 0.55.1 exposes a coarse `clear_all_browsing_data` operation, but the current host does not retain a profile-bound `WebContext` registry. A host-backed browsing-data service must first bind `SessionProfileHandle` to WebView creation and decide which provider buckets can be cleared per profile.

The shipped shape is a Schema-typed `BrowsingData` service over `SessionProfileHandle`, with memory tests proving per-profile partitioning and host routes returning typed `host-browsing-data-unavailable` after strict validation.

Architecture-debt sweep: no cache manager, browsing-data DSL, or bridge-specific wrapper was added. `SessionProfileHandle` remains the single partition identity, and `BrowsingData` owns only data-bucket policy, schema, permission checks, and events.

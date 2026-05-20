# Network Auth

WebView has no local profile-bound host path for proxy settings, HTTP auth challenges, or certificate decisions. A host-backed network-auth service must first route provider callbacks through `SessionProfileHandle` and preserve security failures as typed errors.

The shipped shape is a Schema-typed `NetworkAuth` service over `SessionProfileHandle`, with memory tests proving proxy/auth/certificate success, permission denial before client work, typed unsupported and host failures, and denied or malformed certificates as security failures.

Architecture-debt sweep: no proxy manager wrapper, certificate DSL, or browser-auth convenience adapter was added. `NetworkAuth` owns only profile-scoped network-auth policy, schema, permission checks, typed security failure mapping, and events.

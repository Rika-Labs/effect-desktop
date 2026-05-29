# Session Permission Manager

WebView declares permission-request phases, but the current host does not retain profile-bound permission callbacks that can be routed through a central policy service. A host-backed session permission manager must first bind `SessionProfileHandle` to WebView creation and route provider permission prompts through the host event loop.

The shipped shape is a Schema-typed `SessionPermission` service over `SessionProfileHandle`, with memory tests proving partitioned decision logs, event replay, denial-before-client-work behavior, and host routes returning typed `host-session-permission-unavailable` after strict validation.

Architecture-debt sweep: no permission manager wrapper, custom browser-permission DSL, or bridge-specific policy layer was added. `SessionPermission` owns only profile-scoped permission policy, schema, permission checks, decision history, and events.

# Download Service

WebView declares download runtime phases, but the current host does not retain profile-bound provider download callbacks or destination-selection routing. A host-backed download service must first bind `SessionProfileHandle` to WebView creation and route provider download events through retained native resources.

The shipped shape is a Schema-typed `Download` service over `SessionProfileHandle`, with memory tests proving generation-stamped resources, scope cleanup, ordered terminal cancellation events, permission denial before client work, and host routes returning typed `host-download-unavailable` after strict validation.

Architecture-debt sweep: no download manager wrapper, custom lifecycle DSL, or bridge-specific download abstraction was added. `Download` owns only resource lifecycle, schema, permission checks, snapshots, and events.

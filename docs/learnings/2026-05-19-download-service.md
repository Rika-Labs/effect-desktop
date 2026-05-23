# Download Service

WebView declares download runtime phases, but the current host does not retain profile-bound provider download callbacks or destination-selection routing. A host-backed download service must first bind `SessionProfileHandle` to WebView creation and route provider download events through retained native resources.

The shipped shape is a Schema-typed `Download` surface over `SessionProfileHandle`, but the only callable TypeScript API in this build is `isSupported` plus the `Download.Event` stream. The memory client is a supported no-op substitute: `isSupported()` returns `{ supported: true }` and `events()` is empty. It does not prove generation-stamped resources, scope cleanup, ordered terminal cancellation events, or permission-denial paths.

Architecture-debt sweep: no download manager wrapper, custom lifecycle DSL, or bridge-specific download abstraction was added. The shipped `Download` code owns the typed surface, unsupported capability facts, host-unavailable support truth, bridge event decoding, and the minimal memory/unsupported test substitutes.

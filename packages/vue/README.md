# @effect-desktop/vue

Vue integration for app-scoped Effect Desktop RPC clients.

The package declares `vue` as a peer dependency because the adapter must use Vue's native `provide` / `inject` and ref lifecycle instead of copying React hook semantics. App packages own the concrete Vue version; this package only binds Effect Desktop descriptors to Vue composables.

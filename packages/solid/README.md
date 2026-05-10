# @effect-desktop/solid

Solid integration for app-scoped Effect Desktop RPC clients.

The package declares `solid-js` as a peer dependency because the adapter must use Solid's owner lifecycle, context, accessors, and signal updates directly. App packages own the concrete Solid version; this package only binds Effect Desktop descriptors to Solid-native primitives.

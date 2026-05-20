# Session Profile Handles

Wry 0.55.1 has `WebContext::new(data_directory)` and cookie primitives, but the current host WebView creation path does not retain a profile registry or accept a profile handle when building child WebViews.

The shipped shape is a Schema-typed `SessionProfile` resource contract with `ResourceRegistry` cleanup. Host methods are routed and validate payloads, then return `host-session-profile-routing-unavailable` until WebView creation can bind profiles to Wry contexts.

Architecture-debt sweep: no `WebViewSessionManager` or bridge DSL was added. The durable abstraction is the browser-state resource boundary; lifecycle remains Effect `ResourceRegistry`, and the host adapter remains a small native/web boundary.

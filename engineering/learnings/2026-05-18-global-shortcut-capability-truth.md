# Global Shortcut Capability Truth

The GlobalShortcut surface already had a typed Effect API and command-binding lifecycle, but the Rust host routes registration methods to typed unsupported responses. Capability metadata must describe the executable host behavior, not the intended future adapter.

The correction marks `GlobalShortcut.register`, `GlobalShortcut.unregister`, and `GlobalShortcut.unregisterAll` unsupported across macOS, Windows, and Linux with `host-adapter-unimplemented`, keeps query methods routed, and stops reporting X11 support until a real native shortcut backend exists.

Architecture-debt sweep: `bindScopedCommand` remains because it owns durable command-binding policy, resource cleanup, event subscription, and command invocation. The remaining debt is the missing native shortcut/accelerator registry and platform adapters tracked by #1368.

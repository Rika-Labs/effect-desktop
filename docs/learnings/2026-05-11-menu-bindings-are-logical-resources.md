# Menu bindings are logical resources

## Context

Issues #582 and #583 exposed the same lifecycle bug in `Menu.bindCommand` and `ContextMenu.bindCommand`: repeating setup for the same `(itemId, commandId)` pair created another native bind and another activation listener.

## What changed

Both binding paths now check the logical resource id before native registration. An active binding returns the existing resource handle instead of starting another listener.

## Lesson

Generated fallback resource ids are useful for anonymous resources, but command bindings are not anonymous. When an app-visible pair is the ownership key, check that key before side effects begin.

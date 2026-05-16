---
date: 2026-05-11
topic: Settings stream disposal
issues: [682]
---

# Settings stream disposal

The issue asked `SettingsStore.close()` to terminate active `changes()` and
`migrated()` subscribers. The implementation already owned both PubSubs inside
`Settings.open`, but the public close path returned `Effect.void`, so subscriber
fibers could stay blocked after the store owner believed disposal had completed.

The fix keeps ownership in the store that created the streams. `close()` now
shuts down the changes PubSub and the migration PubSub, and focused tests prove
both open stream fibers complete after store disposal. Repeated `close()` calls
also remain safe, matching the store lifecycle contract callers need during
runtime shutdown.

The important lesson is that a stream-producing service must treat its stream
source as owned state. A no-op close can look harmless when the durable backing
store has no explicit resource, but live streams are resources too: if they do
not receive a terminal signal, cleanup is not observable and shutdown leaks
work.

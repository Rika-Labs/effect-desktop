# Delete Zero-Policy Effect Re-Exports

Issue #1280 removed core runtime modules that only renamed upstream Effect APIs:
`runtime/event-log`, `runtime/reactivity`, and `runtime/workflow`.

The important distinction was ownership. `audit-events.ts` stayed because it
owns Effect Desktop audit taxonomy, redaction, and event reactivity keys.
Desktop backup/restore/autosave workflows stayed because they own app data
lifecycle. The deleted modules did not own policy; they trained callers to
import Effect through local aliases.

The review loop caught the real failure mode for this cleanup: deleting wrapper
exports is not enough if docs still advertise the old local API. The README and
phase milestone needed to say that EventLog is now the upstream Effect primitive,
while desktop audit policy remains local.

The durable rule is simple: when removing a wrapper around an Effect primitive,
remove the source file, the root export, the package subpath, the snapshot
symbols, and the docs example in the same change. Then add a repo-shape guard so
the deleted wrapper name cannot return silently.

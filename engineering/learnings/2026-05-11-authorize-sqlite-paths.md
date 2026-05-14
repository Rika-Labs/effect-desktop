# Authorize SQLite Paths

## Planned

Issue #860 required file-backed SQLite connections to pass through the runtime permission model before Bun opens or creates a database file.

## Shipped

`PermissionRegistry` now understands `sqlite.open` capabilities with database roots and deny roots. `makeSQLite` accepts an optional permission registry, canonicalizes file-backed database paths, checks `sqlite.open`, and only then constructs `new Database(...)`. `:memory:` remains an internal, non-file-backed SQLite path.

## Review surfaced

The side effect boundary is file creation, not SQL execution. The useful permission unit is therefore the canonical database path under a declared root.

## Non-obvious lesson

Opening SQLite is a filesystem operation even when the API looks like a database API. Treating it as its own capability keeps audit records precise without reusing `filesystem.write` as an overloaded proxy.

## AGENTS.md amendment candidate

None.

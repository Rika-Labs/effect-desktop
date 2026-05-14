---
date: 2026-05-11
topic: Command registration visibility
issues: [692]
---

# Command registration visibility

Command registration needs a reservation phase to prevent duplicate ids while
the resource handle is being registered. The bug was that the reservation lived
in the same visible map that `invoke()` and `list()` used, so a command could be
called before its resource cleanup path existed.

The fix keeps one map but makes the state explicit. New registrations enter as
`committed: false`; duplicate checks and rollback can still see them, while
public lookup and listing treat them as absent. Only after `resources.register`
returns the live handle does the registry flip the command to committed and
publish it to callers.

The lesson is that reservation is not publication. A lifecycle owner can reserve
identity early, but external side effects must wait until the resource that
cleans them up has committed.

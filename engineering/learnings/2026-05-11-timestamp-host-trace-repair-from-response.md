---
date: 2026-05-11
topic: Host trace repair audit timestamps
issues: [667]
---

# Host trace repair audit timestamps

Trace repair is caused by the malformed host envelope, not by the original
request. The audit event used the request timestamp, so diagnostics could show a
repair before the response that required it.

The fix reads a valid timestamp from the parsed host object before adding the
missing trace id. The audit event now uses that response timestamp while keeping
request id and method in details for correlation. If the parsed object has no
valid timestamp, repair fails as invalid host output instead of emitting a
mis-timed audit row.

The lesson is that correlation fields and event time answer different
questions. Request metadata belongs in details; the audit event timestamp should
come from the boundary event being repaired.

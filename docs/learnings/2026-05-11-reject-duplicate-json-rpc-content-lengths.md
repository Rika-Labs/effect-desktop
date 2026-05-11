# Reject Duplicate JSON-RPC Content Lengths

## Planned

Close #471 by rejecting JSON-RPC frames whose headers contain more than one `Content-Length` line.

## Shipped

`parseContentLength` now collects matching header lines and requires exactly one valid decimal value. Missing, duplicate matching, and duplicate conflicting length headers all fail through the existing invalid-header path.

## Review

The test covers both conflicting duplicates and identical duplicates. A framing boundary should have one authoritative length, not multiple values that different peers may interpret differently.

## Lesson

Header parsers should reject ambiguity, not pick the first convenient value. Silent tie-breaking at a framing boundary becomes protocol disagreement later.

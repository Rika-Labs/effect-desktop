# Native result invariants

## Planned

Close issues #578 and #579 by rejecting contradictory or unusable native host results before app code observes them.

## Shipped

`WebView.captureScreenshot` now rejects empty byte payloads explicitly before image header validation. `App.requestSingleInstanceLock` now uses an output schema that rejects `acquired: true` when `primaryPid` is present.

## Review surfaced

Field-level schemas accepted values that were syntactically valid but semantically impossible. A `Uint8Array` can be empty, and a single-instance result can contain both ownership states unless the cross-field invariant is encoded.

## Lesson

Native bridge outputs need domain invariants after shape decoding. A successful host response must be usable and internally coherent, not merely well-typed.

## AGENTS.md amendment candidate

None.

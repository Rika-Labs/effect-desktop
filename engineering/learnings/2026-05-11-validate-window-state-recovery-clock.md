# Validate Window State Recovery Clocks

## Planned

Close the corrupt window-state recovery path so malformed injected clocks cannot create misleading diagnostic filenames.

## Shipped

Corrupt-file recovery now validates the clock before building `window-state.corrupt.<timestamp>.json`. Invalid values fail as `WindowStateReadFailed` and leave the original corrupt file in place.

## Review Surface

The decision was to fail recovery instead of inventing a fallback timestamp. A fake fallback would preserve the happy path but would make operator evidence less truthful.

## Lesson

Diagnostic artifact names are part of the reliability surface. Validate the data used to name them before touching the filesystem.

# Validate Publish Timestamps

## Planned

Keep malformed publish clock values inside the typed publish pipeline error model.

## Shipped

`runDesktopPublish` now normalizes `publishedAt` through a finite valid JavaScript timestamp check before manifest signing and writing. Invalid clocks fail as `PublishConfigError` and leave no `update-manifest.json` behind.

## Lesson

Manifest fields derived from clocks should be validated before signing. Otherwise a test hook or bad runtime clock can escape as a raw platform exception instead of a release pipeline failure.

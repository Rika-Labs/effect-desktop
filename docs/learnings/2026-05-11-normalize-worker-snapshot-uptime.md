# Normalize Worker Snapshot Uptime

## Planned

Close the Worker snapshot boundary so malformed injected clocks cannot leak raw schema construction errors from `Worker.list()`.

## Shipped

Worker uptime is now normalized before constructing `WorkerSnapshot`. Invalid, backwards, or unsafe uptime values become `0`, preserving the infallible `list()` API while keeping snapshot records schema-safe.

## Review Surface

The test fixture had coupled the Worker clock to the ResourceRegistry clock. Splitting those clocks made the fractional Worker uptime test target only the Worker runtime surface.

## Lesson

Infallible snapshot APIs need explicit fallback policies. Letting schema constructors discover bad arithmetic turns an observability surface into another failure point.

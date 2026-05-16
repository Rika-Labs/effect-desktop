# Validate Process Snapshot Timestamps

## Planned

Close #475 by preventing invalid injected clock values from reaching process snapshots exposed by `Process.list()` and `Process.observe()`.

## Shipped

Process snapshot timestamps now decode through a non-negative integer schema. `Process.spawn` validates the start timestamp before reserving budget, spawning the child, or registering a resource, and exit snapshot updates validate the exit timestamp before publishing state.

## Review

The regression tests cover invalid start timestamps before adapter activity and invalid exit timestamps before subscribers see terminal state. Valid clocks still produce deterministic running and exited snapshots.

## Lesson

Observability state is still public API. A bad injected clock should fail at the snapshot boundary instead of leaking into lists, streams, sorting, or duration math.

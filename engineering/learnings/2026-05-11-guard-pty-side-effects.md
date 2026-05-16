# Guard PTY Side Effects

## Planned

Keep malformed PTY writes and stale PTY handles from reaching adapter side effects.

## Shipped

`PTY.write` now validates byte chunks at runtime before calling the child adapter. PTY handle `write`, `resize`, and `kill` now assert the resource handle is still fresh before adapter activity, returning a typed `StaleHandle` failure after child exit or scope close.

## Lesson

Renderer-facing handles are capabilities over resources, not proof that the resource still exists. Side-effect methods must re-check ownership at call time because disposal can happen independently of the caller's stale reference.

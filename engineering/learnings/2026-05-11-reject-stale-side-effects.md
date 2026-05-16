# Reject Stale Side Effects

## Planned

Reject stale runtime and native handles before they can perform side effects across adapter or host boundaries.

## Shipped

Process `kill` now checks the process resource is fresh before signaling the child adapter. Worker `send` now checks the worker resource is fresh before calling the runtime. Tray `destroy` now decodes the destroy payload through the same resource schema path as the other tray mutators.

## Lesson

The registry handle is the source of ownership, not the object reference held by a caller. Any method that mutates external state must validate the handle at call time, because exit, close, and scope cleanup can invalidate it independently.

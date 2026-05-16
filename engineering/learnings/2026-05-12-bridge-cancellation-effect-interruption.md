# Bridge Cancellation Belongs To Effect Interruption

## Context

Issue #1155 removed the bridge client's `AbortSignal` call option and moved
renderer-side cancellation onto Effect interruption.

## Learning

An `AbortSignal` option on every generated bridge method looked convenient, but
it created a parallel cancellation model. The client had to race requests against
callbacks, install stream listeners separately, synthesize local `Cancelled`
errors, and remember to remove DOM listeners. Effect already owns all of that at
the fiber boundary.

The tricky part was in-process exchanges. If the caller directly interrupts the
same Effect that is running the in-process handler, the handler can disappear
before the protocol cancel envelope reaches runtime cancellation. The fix was to
separate caller lifetime from request lifetime: run the request in a detached
request fiber, keep caller cancellation as interruption, and start protocol
cancel cleanup from the release path.

Cancel dispatch must also be bounded. Cleanup should not wait forever for a
transport cancel send, and it should not leave the local request fiber alive if a
transport never answers. The bridge client now starts cancel dispatch
best-effort, bounds interruptible cancel sends, and independently interrupts the
detached request fiber after the dispatch grace window.

## Durable Rule

Do not expose renderer cancellation as a per-method bridge option. Let callers
interrupt Effects or use Effect runtime `AbortSignal` run options at the edge.
Bridge code should only translate interruption into desktop protocol cancel
envelopes, and transport cancel implementations must stay bounded and
interruption-friendly.

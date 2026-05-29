# Deferred findings from the third source-grounded bug sweep (2026-05-29)

The third sweep's clear, low-risk findings were fixed (json-rpc header DoS cap,
client origin-field validation, in-flight rpc dedup, manifest duplicate-window
rejection — commit c96dc54b78). Two sweep findings were verified as **intended
behavior** and deliberately not changed:

- `desktop-app.ts checkPermissions` validates only app RPCs, not native surfaces.
  This is by design — `Desktop.native(...)` is exempt from permission declaration,
  proven by the test "Desktop.native availability does not require matching
  permissions during graph build" (index.test.ts). Routing native registrations
  through `checkPermissions` breaks every native surface that carries a capability.
- `runtimeGraph`/`runtimeGraphSnapshot` deliberately run a shallower validation set
  than `buildSpine` (consistent with the native-permission exemption above).

The remaining findings below need a non-trivial refactor or are low-likelihood
defensive hardening, so they are captured here with their fix shape rather than
rushed into complex subsystems.

## 1. (HIGH) Pre-window firstResponder intent is lost when the pinned window closes before draining

`app-events.ts`: a firstResponder event (e.g. macOS open-document/open-url
delivered before any window exists) is buffered in `bufferedFirstResponder`, then
in `windowOpened` it is pinned to the first window that opens
(`setPendingWindowEvents(..., window.id, buffered)`, ~line 234). If that window
closes before anything subscribes, `windowClosed` clears its pending entry
(`setPendingWindowEvents(..., windowId, [])`, ~line 353) and the intent is
destroyed — with no audit row, unlike the dispatch drop path which emits
`EventDroppedTargetClosed`.

Two fixes, in increasing scope:
- **Observability (small):** in `windowClosed`, capture `pendingEventsFor(current,
  windowId)` inside the `SubscriptionRef.modify` and `emitAudit` an
  `EventDroppedTargetClosed` for each before clearing. Makes the loss visible but
  does not reopen the document.
- **Correct (larger):** stop pinning the global firstResponder buffer to a single
  window at `windowOpened`. Keep it in `bufferedFirstResponder` and drain it on the
  first matching `subscribe`, so a transient first window cannot consume-and-destroy
  a global intent. Pending events carry no route (`AppEventEnvelope` is just
  `{ event, payload }`), so re-buffering on close cannot distinguish firstResponder
  from targeted events — the buffer model itself must change.

Test: publish onOpenFile via `firstResponderRoute` (no windows) → `windowOpened("w1")`
→ `windowClosed("w1")` (no subscribe) → `windowOpened("w2")` → `subscribe("w2","onOpenFile")`;
assert the original payload is delivered to w2 (correct fix) or at least appears as
an audit row (observability fix). Today it is delivered nowhere and audited nowhere.

## 2. (MEDIUM) Server protocol send trusts an unvalidated now()/nextTraceId()

`protocol.ts` server send builds response/stream/defect envelopes with
`resolved.now()` / `resolved.nextTraceId()` raw. A custom `now` returning a
non-integer (or `nextTraceId` returning "") throws in the `Schema.Class`
constructor; the throw is caught by `catchCause` -> `sendRequestDefect` -> rebuilds
with the same bad `now()` -> throws again, so the request never gets a response and
the failure is swallowed to a debug log. The client path already guards this via
`validateHostProtocolTimestamp`. Low likelihood (the default clock returns
integers); only a misconfigured custom `now`/`nextTraceId` triggers it.

Fix: validate/coerce `resolved.now()` to a non-negative integer and ensure
`nextTraceId()` is a non-empty control-free string before constructing server
envelopes, mirroring the client guards.

## 3. (MEDIUM) Devtools full snapshot fails wholesale once the aggregate exceeds the 64KB budget

`snapshot-client.ts exportSnapshot` builds one object from all 10 panels and runs a
single `inspectorSafety.sanitize` over it. The default `maxPayloadBytes` is 64KB,
but a single panel at its default cap (e.g. LiveRuntimePanels' 256 bridge-call rows
~88KB) already exceeds it, so `sanitize` returns `Option.none()` and
`exportSnapshot` fails with `DevtoolsSnapshotSafetyError` — which terminates the
embedded inspector's polling stream (`observe()` wraps `list()` which calls
`exportSnapshot`). This fires on any busy runtime, not just an edge case.

Fix: sanitize each panel section independently so an oversized section is
omitted/truncated (with a per-section safety summary) while the rest survive, OR
size the snapshot-client's `InspectorSafetyPolicy` budget to the sum of per-panel
caps. Treat a `None` decision as "return a reduced snapshot + safety summary"
rather than failing the whole export. Note: bumping the budget naively weakens the
exposure bound, so prefer per-section sanitization.

The low-confidence sweep findings (transport read/write error mislabel, exported
`appendBounded` negative-capacity, `makeFrameworkRuntime` scope-leak window,
sanitizer Option-corruption latent path, app-events publish/close race that does
not reproduce single-threaded, `doctor.ts` semver prerelease comparison,
`release-workflow.ts` idempotency-key delimiter collision) are latent or unreachable
under current callers and are not tracked individually; revisit if a reachable
trigger appears.

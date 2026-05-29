# Seventh sweep — inspector collector, release gates, devtools panels (2026-05-29)

Fixed this session: a11y compound-`@media` evidence regex and lifecycle interrupted-vs-failure
classification (commit c585b992fe); reproducibility-gate vacuous pass on zero compared files
and the over-broad `*-report.json` exclusion (commit 22b58276d5). Each with a regression test
proven to fail pre-fix.

## Open — clear but lower-traffic (devtools / fixture tooling)

### 1. (HIGH) inspector-events fixtures cannot round-trip through JSON

`inspector-events.ts` uses `Schema.OptionFromNullishOr` for traceId/spanId/layerId/providerId.
`encodeInspectorEvent` emits those keys as `undefined` for `None`, which `JSON.stringify` drops,
but `decodeUnknownInspectorEvent` treats the key as required → `replayInspectorFixture` of a
JSON-persisted fixture fails with "Missing key". The module's stated purpose is replaying encoded
fixtures without a live runtime, and the existing test only does in-memory replay (never serializes),
so the gap is unexercised. Fix: `Schema.OptionFromOptionalKey(...)` so `None` ↔ missing key
(JSON-safe). Verify the public-API snapshot (`check --api`) — the encoded shape changes from
present-undefined to absent-key — and add a JSON-round-trip replay test.

### 2. (HIGH) performance-overlay blanks the whole overlay under load

`performance-overlay.ts` routes each row's bulk numeric `samples` array through the byte-budgeted
`inspectorSafety.sanitize`; with ~10 contracts × ~1024 samples the assembled payload exceeds the
64KB policy budget, `sanitize` returns `None`, and the None-branch returns empty startup/bridgeP99
rows and a `budgetMs:0 status:"missing"` renderFrame — so the overlay goes blind exactly when a
frame is genuinely over budget. Same class as the devtools snapshot-client wholesale-sanitize bug
(2026-05-29-third-sweep-deferred §3). Fix: sanitize only caller-text fields (labels/contractTag),
re-attach the numeric `samples`/`valueMs` after sanitize (or cap/omit samples from the sanitized
payload), and preserve each row's real `budgetMs` in the degraded branch.

### 3. (MEDIUM) accessibility-gate accepts axe reports with omitted violations/incomplete arrays

`violations`/`incomplete` are `Schema.optionalKey` and the checks coerce a missing array to `[]`
("no findings"), so a hand-edited evidence file that strips those arrays passes the gate (a real
axe-core report always emits them). Fix: make the evidence arrays required (or fail when absent)
so a tampered/wrong-tool report is rejected rather than treated as clean.

### 4. (MEDIUM) FiberInspectorCollector PubSub is never shut down on layer teardown

`lifecycle-collectors.ts` creates `PubSub.unbounded` in acquire but the release only closes the
FiberMap scope, so `events()` subscribers never observe completion and the buffer is retained per
disposed collector. Fix: `PubSub.shutdown(events)` in the release (close it before/with the scope).

### 5. (MEDIUM) workflows-panel: out-of-order terminal dropped; duplicate Started double-counts

`workflows-panel.ts applyEvent` drops a Completed/Failed/Interrupted arriving before its Started
(execution stuck "running" forever) and appends a second row on a duplicate Started (double counts).
The registry is fed by an async inspector pipeline with no ordering/uniqueness guarantee. Fix: key
the buffer by executionId (idempotent Started; buffer an orphan terminal and apply on the matching
Started, or apply a pending terminal when Started arrives).

## Low confidence (latent / likely-intended)

- semver-guard decodes verification-matrix `requiredCells`/`ciCells`/`manualGateCells` but enforces
  only `Object.keys(rows)`; cell-coverage enforcement may intentionally live in CI. Either enforce
  or narrow the decoded schema to the fields used.
- devtools `shell.ts` loopback devtools-token check uses `!==` (non-constant-time); bounded by
  loopback-only bind + 256-bit per-session token. Use `crypto.timingSafeEqual` for the hardening.
- live-panels bridge-call rows slice a first-insertion-ordered Map, so under maxRows pressure the
  freshest-activity call can be hidden behind older ones; re-insert on update to track recency
  (only wrong if "show most recent N" is the intended contract).
- workflows-panel counts are computed over the 256-row display window while the registry retains
  512, so runningCount can read 0 while work is running; compute counts over the full set or align
  the window with retention.

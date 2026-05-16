# Review: Validate Dock.setBadgeText display strings

## Verdict

LOCKED

## First-principles findings

No blocking findings. The architecture identifies the primitive as badge display text, keeps `null` as clearing data, and validates malformed strings at the SDK boundary before host transport.

## Game-theory findings

No blocking findings. The correct move is cheap because future contributors edit the exported schema where the contract already lives; the bad move is loud because invalid inputs produce `InvalidArgument` and API snapshots expose schema-signature changes.

## Principle compliance findings

No blocking findings. The design avoids a speculative shared abstraction and keeps validation in the single source of truth for Dock host inputs.

## Reality check

### Code grounding

`DockSetBadgeTextInput` currently uses `Schema.NullOr(Schema.String)` in `packages/native/src/contracts/dock.ts`. Dock bridge tests in `packages/native/src/index.test.ts` already capture requests and assert the `Dock.setBadgeText` payload shape. Structural search found no other `Schema.NullOr(Schema.String)` contract field, so a local schema helper is enough.

### Prior art and incentive history

Dialog UI text validation in issue #815 used a private schema helper inside exported schema classes and required an API snapshot update. macOS polish learning records that Dock host methods should preserve the originating operation and reject invalid method input before platform side effects. Those patterns support schema-boundary validation here without host changes.

## Synthesis

The architecture is locked as written. The implementation should make the smallest contract change, add a regression test that proves invalid badge text sends no request, run the native test and API snapshot check, and commit any intentional snapshot delta.

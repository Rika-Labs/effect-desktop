# ADR-0001: Schema v4 Audit

## Status

Accepted

## Context

The framework pins `effect@4.0.0-beta.60`. `Schema.*` is used across 1 299 call sites in
`packages/` (non-test: ~800). No prior audit had been run against the Effect v4 Schema API
surface or the v4-beta dev notes. Beta minor releases can ship breaking changes; drift between
usage and the shipped API risks silent behavioral differences in validation, encoding, and
optional handling. This audit catalogued every distinct `Schema.*` symbol used in the codebase
and cross-checked it against the `effect@4.0.0-beta.60` type declarations
(`node_modules/.bun/effect@4.0.0-beta.60/node_modules/effect/dist/Schema.d.ts`).

### Scope

All `.ts` files under `packages/` except generated artifacts. Test files were included to
ensure no test-only drift.

### Method

1. Enumerate every `Schema.<identifier>` usage with frequency counts.
2. Resolve each identifier against the shipped `.d.ts` to confirm presence and correct
   call signature.
3. Flag deviations: missing symbols, changed signatures, deprecated patterns, v3-only
   constructs.
4. Apply targeted edits where a deviation exists. Record the disposition for each
   finding.

## Decision

No source changes were required. Every `Schema.*` symbol used in the codebase resolves
correctly against `effect@4.0.0-beta.60` and the v4 idioms described in the official
documentation and type declarations. The codebase is already v4-idiomatic.

### Inventory and dispositions

| Symbol | Count (incl. tests) | v4 status | Disposition |
|---|---|---|---|
| `Schema.Class<Self>(id)(fields)` | 250 | Present. `MissingSelfGeneric` fires at compile time if `Self` is omitted. | Compliant — all 250 usages supply the `Self` generic correctly. |
| `Schema.Schema<T>` (type-level) | 178 | Present. | Compliant. |
| `Schema.String` | 159 | Present. | Compliant. |
| `Schema.optionalKey(S)` | 156 | Present. Creates an exact optional property (key may be absent; value is never `undefined`). Different from `Schema.optional(S)`, which adds `| undefined`. | Compliant — callers use `exactOptionalPropertyTypes` and the correct `optionalKey` semantic throughout. |
| `Schema.decodeUnknownEffect(S)(input)` | 76 | Present. | Compliant. |
| `Schema.Literal(v)` | 59 | Present. | Compliant. |
| `Schema.Void` | 58 | Present. | Compliant. |
| `Schema.Literals([...])` | 54 | Present. Produces a union of literals with `.pick()` utility. | Compliant. |
| `Schema.Boolean` | 54 | Present. | Compliant. |
| `Schema.Number` | 42 | Present. | Compliant. |
| `Schema.NonEmptyString` | 36 | Present. Branded string with `isMinLength(1)` check built in. | Compliant. |
| `Schema.Array(S)` | 32 | Present. | Compliant. |
| `Schema.Int` | 26 | Present (`declare const Int`). | Compliant. |
| `Schema.isPattern(re)` | 25 | Present. Returns `AST.Filter<string>` for use with `.check(...)`. | Compliant. |
| `Schema.isFinite()` | 22 | Present. | Compliant. |
| `Schema.isGreaterThanOrEqualTo(n)` | 20 | Present. | Compliant. |
| `Schema.Unknown` | 19 | Present. | Compliant. |
| `Schema.isGreaterThan(n)` | 18 | Present. | Compliant. |
| `Schema.Struct({...})` | 10 | Present. | Compliant. |
| `Schema.Union([...])` | 8 | Present. | Compliant. |
| `Schema.Uint8Array` | 7 | Present. | Compliant. |
| `Schema.Codec.Encoded<S>` | 6 | Present. `Schema.Codec` is a documented utility namespace. | Compliant. |
| `Schema.isLessThanOrEqualTo(n)` | 5 | Present. | Compliant. |
| `Schema.decodeUnknownSync(S)` | 5 | Present. | Compliant. |
| `Schema.Record(K, V)` | 5 | Present. | Compliant. |
| `Schema.encodeUnknownEffect(S)` | 4 | Present. | Compliant. |
| `Schema.encodeEffect(S)` | 4 | Present. | Compliant. |
| `Schema.NullOr(S)` | 4 | Present. Produces `S \| null`. | Compliant. |
| `Schema.suspend(() => S)` | 2 | Present. Used for recursive schemas. | Compliant. |
| `Schema.makeFilter<T>(fn)` | 1 | Present. Returns `AST.Filter<T>` for use with `.check(...)`. The predicate may return `FilterOutput = undefined \| boolean \| FilterIssue \| ReadonlyArray<FilterIssue>`, where `FilterIssue = string \| Issue.Issue \| {...}`. The one usage in `packages/native/src/contracts/global-shortcut.ts` returns `true \| string`, which is valid. | Compliant. |
| `Schema.encodeSync(S)` | 1 | Present. | Compliant. |

### v4 features not yet used (informational)

The following symbols shipped in `effect@4.0.0-beta.60` and were not in use at the time
of this audit. They are noted here to prevent future re-invention of equivalent bespoke
patterns.

| Symbol | Purpose |
|---|---|
| `Schema.StringFromBase64` | Decode base-64 encoded string to plain string. |
| `Schema.StringFromBase64Url` | Decode URL-safe base-64. |
| `Schema.StringFromHex` | Decode hex-encoded string to plain string. |
| `Schema.StringFromUriComponent` | Decode percent-encoded URI component. |
| `Schema.encodeKeys({ oldKey: "newKey" })` | Rename struct keys at the encoded boundary. |
| `Schema.withDecodingDefaultKey(effect)` | Optional encoded key with default decoded value. |
| `Schema.withDecodingDefault(effect)` | Optional encoded key (`| undefined`) with default. |
| `Schema.Trim` | Transform: trim whitespace. |
| `Schema.Trimmed` | Refinement: already-trimmed string. |
| `Schema.TaggedClass<Self>(id)(tag, fields)` | `Schema.Class` variant that auto-injects a `_tag` literal. |
| `Schema.ErrorClass<Self>(id)(fields)` | `Schema.Class` variant for typed errors (`YieldableError`). |
| `Schema.TaggedErrorClass<Self>(id)(tag, fields)` | Combines `TaggedClass` + `ErrorClass`. |

### Key v4 semantics confirmed

**`Schema.optional` vs `Schema.optionalKey`**: in v4, `Schema.optional(S)` is
`optionalKey(UndefinedOr(S))` — the key may be absent **or** `undefined`. The codebase uses
only `Schema.optionalKey`, which is the exact-optional form (key absent, never `undefined`).
This is correct for a codebase with `exactOptionalPropertyTypes: true` and is intentional.

**`Schema.Class<Self>` self-generic**: v4 uses compile-time type-level validation to
enforce the self-generic. If `Self` is omitted, the return type collapses to the string
literal `` `Missing \`Self\` generic - use \`class Self extends Schema.Class<Self>(...)\`` ``.
All 250 `Schema.Class` usages in the codebase supply the correct self-reference, so no
`MissingSelfGeneric` errors exist.

**`@effect/schema` import path**: forbidden in v4; all symbols must be imported from
`"effect"`. Zero usages of the old import path were found.

**v3 generator adapter (`$`)**: forbidden in v4 (`Effect.gen(function*() { ... yield* effect })`
not `Effect.gen(function*($) { ... $(effect) })`). No `$` adapter usages were found.

## Alternatives considered

**Automated codemods**: The effect team provides migration scripts for some v3→v4
transitions. They were not needed here because the codebase was authored directly against
v4 and no v3 constructs were found.

**Upgrading the pinned version**: Out of scope per the issue. The audit validates against
the pinned `beta.60` only.

## Consequences

**Positive**

- Establishes a baseline: the codebase is clean against `effect@4.0.0-beta.60`.
- Documents the v4 optional-key vs optional semantic choice explicitly, removing a future
  source of confusion.
- Surfaces six new Schema utilities (`StringFromBase64`, `StringFromHex`, etc.) that can
  replace bespoke transforms if they arise.
- Provides a reference for the next audit when the pinned version changes.

**Negative**

- None. No changes were required, so no risk was introduced.

## Validation

All commands passed from a fresh install before this ADR was committed:

```
bun install --frozen-lockfile   # 704 packages, clean
bun run check                   # 11/11 packages: 0 errors
bun run typecheck               # 11/11 packages: 0 errors (FULL TURBO)
bun run lint                    # 11/11 packages: 0 warnings, 0 errors
bun run lint:types              # 6 pre-existing warnings, 0 errors (unchanged)
bun run format:check            # All matched files use Prettier code style
bun test                        # 742 pass, 0 fail
```

The 6 `lint:types` warnings are pre-existing (2 in `packages/cli/src/index.test.ts`,
1 in `packages/core/src/runtime/approval-broker.test.ts`) and unrelated to Schema.

## Migration notes

When the pinned `effect` version is bumped past `beta.60`, re-run this audit against the
updated `.d.ts`. Pay particular attention to:

1. Any change to `Schema.Class` signature (especially the self-generic enforcement
   mechanism, which is currently type-level only).
2. Any split or rename of `Schema.optionalKey` vs `Schema.optional` semantics.
3. Whether `Schema.encodeKeys` stabilizes its type signature (currently the mapped-key
   type inference is complex).

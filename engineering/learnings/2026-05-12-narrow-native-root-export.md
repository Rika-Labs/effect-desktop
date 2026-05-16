# Narrow native root export

## Planned

Issue #1219 asked for `@effect-desktop/native` to stop exposing implementation modules and
schema contracts through the package root. The target shape was a root barrel for stable native
services, a contracts subpath for schema-coded payloads, and an explicit protocol subpath for
bridge-facing protocol consumers.

## Shipped

`packages/native/src/index.ts` is now an explicit named barrel. It keeps all spec-listed native
services, client ports, live layers, RPC groups, bridge-client layer constructors, service-layer
constructors, unsupported clients, and typed service errors on the root. It no longer exports app
event routing, app HTTP server internals, crash/update workflow helpers, or contract schemas by
accident.

`packages/native/src/contracts/index.ts` now aggregates the schema-coded native request, response,
handle, result, and event contracts. `packages/native/package.json` exposes `./contracts` and
`./protocol` as intentional subpaths. First-party consumers that needed payload contracts now import
from `@effect-desktop/native/contracts`.

The native API snapshot records the intentional root reduction, and the roadmap progress table now
marks #1205, #1178, and #1219 as implemented with concrete evidence.

## Verification

- `bun test packages/native/src/index.test.ts -t "native package"`
- `bun test packages/native/src/index.test.ts packages/test/src/index.test.ts packages/react/src/index.test.ts templates/basic-react-tailwind/src/template.test.ts`
- `bun packages/cli/src/bin.ts check --api`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
- `bun test`

## Lesson

Wildcard barrels make compatibility boundaries invisible. The stable package contract should be
named at the root, while schema/data contracts and implementation adapters should have explicit
subpaths so dependency choices show up in review.

# Issue #1280: Delete Zero-Policy Effect Re-Export Wrappers

## Problem

`packages/core/src/runtime/event-log.ts`, `reactivity.ts`, and `workflow.ts`
mostly rename upstream Effect APIs. They do not own durable desktop policy,
lifecycle, security, or protocol translation, so keeping them teaches callers to
depend on Effect Desktop aliases instead of canonical Effect modules.

`packages/core/src/runtime/platform.ts` was already removed by #1213.

## Target Shape

Callers import Effect primitives directly:

```ts
import { EventLog } from "effect/unstable/eventlog"
import { Reactivity } from "effect/unstable/reactivity"
import { WorkflowEngine } from "effect/unstable/workflow"
```

Effect Desktop keeps only modules that own desktop semantics, such as audit event
taxonomy, permission approval lifecycle, desktop workflows, provider selection,
and resource/permission policy.

## Architecture Debt Sweep

Delete:

- `packages/core/src/runtime/event-log.ts`
- `packages/core/src/runtime/reactivity.ts`
- `packages/core/src/runtime/workflow.ts`

Keep:

- `packages/core/src/runtime/audit-events.ts`: owns desktop audit event schema,
  redaction, and reactivity keys.
- `packages/core/src/runtime/permission-approval-workflow.ts`: owns permission
  approval lifecycle and registry/audit policy.
- `packages/core/src/runtime/workflows/*.ts`: owns desktop backup, restore, and
  autosave semantics.
- `packages/core/src/runtime/sqlite.ts`: owns desktop resource, permission, and
  Bun SQLite policy. Deeper SQL simplification is already tracked by #1267.

No new follow-up issue is needed for #1280 because the wrappers can be removed
fully in this ticket. Guardrails against future wrapper drift are already
tracked by #1284.

## Files

- `packages/core/src/index.ts`
  - Remove public re-exports for the deleted wrapper modules.
  - Use `WorkflowEngine.layerMemory` from `effect/unstable/workflow` directly.
  - Inline the desktop workflow layer shape in the small compatibility facade.

- `packages/core/src/runtime/desktop-app.ts`
  - Use `Reactivity.layer` from `effect/unstable/reactivity` directly.
  - Use `WorkflowEngine.layerMemory` from `effect/unstable/workflow` directly.
  - Replace `WorkflowLayer` with a local `DesktopWorkflowLayer` type because it
    describes what the desktop app graph accepts, not a renamed Effect API.

- `templates/todo-sqlite/src/spine.ts`
  - Import `Reactivity` from `effect/unstable/reactivity`.
  - Use `Reactivity.mutation` and `Reactivity.layer` directly.

- `packages/core/src/index.test.ts`
  - Replace `WorkflowLayer` casts with `DesktopWorkflowLayer`.
  - Assert the core root no longer exports zero-policy wrapper names.

- `tests/repo-shape.test.ts`
  - Add a guard that the deleted wrapper files do not come back.

- `packages/core/src/runtime/event-log.test.ts`
  - Remove. It only tests upstream EventLog behavior through the deleted wrapper.

- `packages/core/src/runtime/workflow.test.ts`
  - Remove. It only tests upstream workflow behavior through the deleted wrapper.

- `api/snapshots/@effect-desktop__core.snapshot.json`
  - Regenerate after the public surface changes.

- Docs
  - Update active docs that still describe the deleted event-log wrapper as the
    current public API.

## Verification

Run focused checks first:

```bash
bun test packages/core/src/index.test.ts packages/core/src/runtime/audit-events.test.ts tests/repo-shape.test.ts
bun run typecheck
```

Then run the full local gate before pushing:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run lint:types
bun run check
bun test
bun run build
bun run desktop check --api
cargo fmt --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

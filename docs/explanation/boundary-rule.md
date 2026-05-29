---
title: The boundary rule
description: Why renderer code never receives raw native authority — and what you get in exchange.
kind: explanation
audience: app-developers
effect_version: 4
---

# The boundary rule

> **Renderer code does not call native operations directly. It calls a typed RPC client. The runtime executes the operation behind a permission check.**

That is the entire rule. It costs you a small amount of indirection at every native call site. It buys you four properties that are very hard to retrofit later:

- **A permission chokepoint.** Every privileged call passes through `PermissionRegistry`. There is no path around it.
- **A typed failure surface.** Native errors arrive as tagged values, not thrown exceptions.
- **An audit trail.** Every privileged call writes a structured event with actor, capability, outcome, and trace id.
- **A test double.** Every native call has a deterministic in-memory replacement. No real OS needed in CI.

## What the rule prohibits

Inside renderer code (anything under your renderer entry, your React/Solid/Vue components, your client-side state):

- ❌ No `node:fs`, `node:child_process`, `node:os`, or any native module imports.
- ❌ No direct calls to platform clipboard, dialog, screen, notification, or shell APIs.
- ❌ No reading or writing `HostProtocolEnvelope` values by hand. (Tests may construct them.)
- ❌ No long-lived references to runtime resources by raw id.

## What the rule allows

In renderer code:

- ✅ Calls to generated clients via `useDesktop(NativeRpcs)`, e.g. `clipboard.writeText.useMutation()`.
- ✅ Subscriptions through `useDesktopStream(...)` or `useSubscribable(...)`.
- ✅ Permission prompts and approval UI via `usePermission`, `usePermissionApproval`, `PermissionApprovalQueue`.
- ✅ Window helpers from the React adapter: `useCurrentWindow`, `useCreateWindowMutation`, `useCloseCurrentWindowMutation`.

## Why this is non-negotiable

Most desktop framework breaches share a shape: **the renderer was given more authority than it needed**. A deserialized message from a malicious page reads a credential. A regex in a URL bar opens a shell. A drag-and-drop traversal escapes the sandbox. Once the renderer can do _anything_ privileged, the entire renderer becomes part of the trust boundary, including every NPM dependency you ship into it.

Putting the chokepoint in the runtime narrows the boundary to a single typed surface. The renderer can ship arbitrary JavaScript; the runtime decides what calls succeed.

## The cost you pay

Three small things:

1. **An RPC declaration for every operation.** You write an `Rpc.make(...)` and a handler. The framework gives you a typed client in return.
2. **Permission declarations.** Privileged operations (filesystem write, process spawn, secret access, native invoke) need a declared capability. You write it once at startup; every check is automatic.
3. **No "just call it" escape hatches.** When something is genuinely synchronous and trivial — say, computing a hash — put it in a pure module the renderer imports directly. Native authority is never that.

## The cost you avoid

In exchange, you do **not** pay for these later:

- A permission audit, because every native call is already audited.
- A test rewrite when CI moves to a sandbox, because every native call already has a memory replacement.
- A security review of every renderer dependency, because the renderer's authority is bounded by the contract.
- A lifecycle bug, because every long-lived thing already has an owning scope.

## What enforces the rule

Two layers:

1. **The boundary surface.** `@orika/bridge` only carries Schema-validated capability-annotated RPCs; the `PermissionInterceptor` middleware decodes each call's capability annotation and checks it before the handler runs. There is no untyped escape that bypasses the interceptor.
2. **The `PermissionRegistry` itself.** Even if you smuggle a raw call into a handler, the registry returns `PermissionDenied` without a matching declaration. Handlers cannot opt out of the check.

## When you think you have a real exception

You usually don't. The most common temptation is "this one specific user-driven action should be allowed without a check." The framework's answer is: declare it as an `allow` capability in the registry, ideally scoped to an actor or window. The behavior is the same; the audit trail is preserved; future you can find every site by grepping the capability name.

If the operation cannot be expressed as a capability — say, you need to share renderer state across two windows synchronously — that is a renderer-side concern. Use the renderer's own state plumbing. The boundary rule is about _native authority_, not about every cross-component flow.

## Related

- [Architecture overview](architecture.md) — three process roles
- [Permissions model](permissions-model.md) — deny-by-default, decision order, audit
- [Audit and redaction](audit-and-redaction.md) — why every privileged call is observable
- Reference: [`PermissionRegistry`](../reference/services/permission-registry.md)

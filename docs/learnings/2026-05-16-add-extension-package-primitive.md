---
date: 2026-05-16
type: in-flight-feature
topic: Add extension package primitive
issue: https://github.com/Rika-Labs/effect-desktop/issues/1386
pr: none
---

# Add extension package primitive

## Decision

Installing an extension package must require separate authority for package lifecycle and for every capability the package will receive.

## What changed

The issue asked for a product-neutral extension package primitive with Schema contracts, tagged Effect failures, permission enforcement, manifest validation, source provenance, host wiring, docs, tests, and API snapshots. The shipped primitive exposes install, update, remove, list, support, and event APIs through a Layer-backed `ExtensionPackage` service with memory and unsupported clients.

The platform-fit review changed the permission gate. The first implementation checked `native.invoke` before install/update and registered manifest-declared capabilities after host success. The final implementation also checks every manifest capability against the installing actor before host side effects or capability registration.

## Why it mattered

The invariant is that package install authority is not capability minting authority. A caller allowed to install packages must not automatically be allowed to grant filesystem, network, process, or secret access to a new extension. The missing early information was that `PermissionRegistry.declare` creates an allow rule, so registration is itself a privileged action.

## Example

```ts
const install = Effect.gen(function* () {
  yield* checkPackagePermission(options, "install", actor, manifest.id, traceId)
  yield* checkManifestCapabilityPermissions(options, "install", actor, manifest, traceId)
  const result = yield* client.install(toInstallInput(request))
  yield* registerManifestCapabilities(options, manifest, traceId)
  return result
})
```

## Rule candidate

Treat permission registration as privileged work. Why: declaring an allow rule changes future authority even when the current operation has not touched files, network, processes, or secrets yet.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.

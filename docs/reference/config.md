---
title: Configuration
description: defineDesktopConfig, schema, production checks.
kind: reference
audience: app-developers
effect_version: 4
---

# Configuration

`@orika/config` owns the typed `desktop.config.ts` schema and the production check rules enforced by `desktop check`.

## Import

```ts
import {
  defineDesktopConfig,
  decodeDesktopConfig,
  effectiveCspPolicy,
  runProductionCheck,
  formatProductionCheckReport
} from "@orika/config"
```

## `defineDesktopConfig(config)`

Typed identity function — gives you autocomplete and compile-time validation against `DesktopConfig`.

```ts
import { defineDesktopConfig } from "@orika/config"

export default defineDesktopConfig({
  app: {
    id: "dev.example.notes",
    name: "Notes",
    version: "0.1.0"
  },
  renderer: {
    framework: "react",
    entry: "src/main.tsx",
    dist: "dist"
  }
})
```

## Top-level fields

| Field         | Type                                     | Required | Description                                                  |
| ------------- | ---------------------------------------- | -------- | ------------------------------------------------------------ |
| `app`         | `DesktopAppConfig`                       | no       | id, name, version                                            |
| `runtime`     | `DesktopRuntimeConfig`                   | no       | engine (`"bun"` \| `"node"`), entry path                     |
| `renderer`    | `DesktopRendererConfig`                  | no       | framework, styling, entry, dist                              |
| `web`         | `DesktopWebConfig`                       | no       | engine (`"system"` \| `"chrome"`)                            |
| `native`      | `DesktopNativeConfig`                    | no       | host crate path overrides                                    |
| `protocols`   | `DesktopProtocolConfig[]`                | no       | custom URL scheme handlers                                   |
| `protocol`    | `DesktopProtocolRuntimeConfig`           | no       | wire-format limits (frame size, concurrency)                 |
| `build`       | `DesktopBuildConfig`                     | no       | build targets                                                |
| `signing`     | object                                   | no       | per-platform signing config                                  |
| `windows`     | object \| array                          | no       | window declarations (JSON form for tooling)                  |
| `update`      | `DesktopUpdateConfig`                    | no       | updater channel, signing keys, install policy                |
| `security`    | `DesktopSecurityConfig`                  | no       | typed bridge, permissions, CSP, redaction, external nav      |
| `permissions` | `DesktopPermissionsConfig` \| JSON array | no       | filesystem / process / secrets policy (or capability values) |
| `appProtocol` | `DesktopAppProtocolConfig`               | no       | app-protocol path traversal flag                             |
| `resources`   | `DesktopResourceConfig`                  | no       | resource scope policy                                        |
| `contracts`   | `DesktopContractCapabilityRequirement[]` | no       | required RPC capabilities and platform support guards        |
| `telemetry`   | `DesktopTelemetryConfig`                 | no       | redaction and endpoint                                       |
| `env`         | `Record<string, Record<string, string>>` | no       | per-profile environment variables                            |
| `workspace`   | `DesktopWorkspaceConfig`                 | no       | shared workspace config path                                 |

`security.csp` and `security.redaction` live under `security`, not at the top level. There is no top-level `publishing` key; updater signing lives under `update`.

`renderer.framework` defaults to `"react"` and accepts `"react"`, `"solid"`, or `"vue"`. The build report records the selected framework as the renderer provider. Next apps should use the `@orika/next` client adapter over React; there is no separate `renderer.framework: "next"` build mode today.

See [`packages/config/src/index.ts`](../../packages/config/src/index.ts) for every nested field.

## `decodeDesktopConfig(raw)`

Decodes an untyped value (e.g. parsed JSON) through the schema. Returns a typed `DesktopConfig` or fails as `DesktopConfigDecodeError`.

```ts
const config = await Effect.runPromise(decodeDesktopConfig(rawJson))
```

## `mergeDesktopConfig(...configs)`

Merges multiple partial configs left-to-right. Useful for composing per-environment overrides.

## Runtime and WebView engines

`runtime.engine` selects the JavaScript runtime used by CLI build and package commands. It maps to the same provider descriptors available through `Desktop.provider(...)`:

- `bun` — default runtime provider.
- `node` — Node runtime provider.

`web.engine` selects the native WebView provider for the host manifest:

- `system` — default OS WebView provider.
- `chrome` — bundled Chromium/CEF provider. The build requires assets at `native/chrome/<target>` and copies them into the packaged layout at `native/chrome`.

Legacy config files that say `web.engine: "chromium"` decode to the canonical `chrome` value.

## `effectiveCspPolicy(cspConfig)` → `CspPolicy`

Computes the effective CSP from your declared policy and any acknowledged weakenings. Returned policy is what the framework will inject into the renderer.

The default `script-src` is nonce-based and includes `'wasm-unsafe-eval'` so packaged renderer database engines can compile WebAssembly. It still forbids broad `'unsafe-eval'` and inline scripts without the host-injected nonce.

## Production checks

`runProductionCheck(input)` runs the static security checks. It takes a `ProductionCheckInput`:

```ts
interface ProductionCheckInput {
  readonly config: ProductionSecurityConfig
  readonly configPath?: string
  readonly rendererFiles?: ReadonlyArray<ProductionCheckFile>
}
```

`config` is the `security` / `permissions` / `update` / `appProtocol` / `resources` / `contracts` slice of `DesktopConfig`. `rendererFiles` are scanned for renderer-side rule violations.

Returns:

```ts
class ProductionCheckReport {
  readonly passed: boolean
  readonly failures: ReadonlyArray<ProductionCheckViolation>
  readonly acknowledgements: ReadonlyArray<ProductionCheckViolation>
}
```

`failures` are unacknowledged `fail` violations; `acknowledgements` are entries that the config explicitly downgraded (currently `weakened-csp` via `security.csp.acknowledgeWeakening` + `security.csp.justification`, and `devtools-in-prod`). Each violation has `{ rule, severity, message, fix, location, justification? }`.

### Rule ids

`ProductionRuleId` is a closed union of 14 rule names:

| Rule                                   | What it catches                                          |
| -------------------------------------- | -------------------------------------------------------- |
| `renderer-backend-import`              | Renderer code importing `node:*` or backend modules      |
| `raw-bridge-call`                      | Renderer constructing `HostProtocolEnvelope` directly    |
| `renderer-native-host-protocol`        | Renderer-side use of host protocol primitives            |
| `filesystem-write-without-scope`       | A filesystem write path missing an owning resource scope |
| `process-permission-without-policy`    | `Process` use without an explicit permission policy      |
| `secret-access-without-audit`          | `Secrets` access where audit was disabled                |
| `update-install-without-signature`     | `Updater.install` without signature verification         |
| `app-protocol-path-traversal`          | App-protocol routing that allows `..` traversal          |
| `weakened-csp`                         | CSP weakening without an explicit acknowledgement        |
| `unsafe-external-navigation`           | External navigation policy missing                       |
| `devtools-in-prod`                     | Devtools layer enabled in production builds              |
| `unscoped-resource`                    | Resource registered without an owner scope               |
| `unsupported-capability-without-guard` | Platform-limited call without `isSupported` guard        |
| `secret-pattern-not-redacted`          | Secret-shaped value emitted without redaction            |

Rules that support acknowledgement (currently `weakened-csp` and `devtools-in-prod`) downgrade from `fail` to `acknowledged` when the config sets the rule-specific opt-in plus a justification. The release gate refuses unacknowledged failures.

## Acknowledging a weakened CSP

```ts
security: {
  csp: {
    policy: "script-src 'self' https://oauth.example.com",
    acknowledgeWeakening: true,
    justification: "OAuth iframe required; tracked in #123"
  }
}
```

The violation still appears in `report.acknowledgements`, but does not fail the gate. There is no top-level `security.acknowledgements` array.

## Format

```ts
const text = formatProductionCheckReport(report)
console.log(text)
```

Renders the report as a human-readable table for terminals.

## Related

- Reference: [CLI commands](cli.md)
- How-to: [Sign and notarize](../how-to/sign-and-notarize.md)
- Source: [`packages/config/src/index.ts`](../../packages/config/src/index.ts)

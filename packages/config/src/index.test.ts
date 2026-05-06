import { expect, test } from "bun:test"
import { Effect } from "effect"

import {
  formatProductionCheckReport,
  runProductionCheck,
  type ProductionSecurityConfig
} from "./index.js"

test("ProductionChecker fails unsafe CSP without acknowledgement", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      configPath: "desktop.config.ts",
      config: {
        security: {
          csp: {
            policy: "default-src 'self'; script-src 'self' 'unsafe-inline'"
          }
        }
      }
    })
  )

  expect(report.passed).toBe(false)
  expect(report.failures.map((violation) => violation.rule)).toEqual(["weakened-csp"])
  expect(formatProductionCheckReport(report)).toContain("security.csp")
})

test("ProductionChecker reports acknowledged CSP weakenings without failing", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        security: {
          csp: {
            policy: "default-src 'self'; script-src 'self' 'unsafe-inline'",
            acknowledgeWeakening: true,
            justification: "Legacy payment provider inline bootstrap until SDK v3 ships"
          }
        }
      }
    })
  )

  expect(report.passed).toBe(true)
  expect(report.failures).toEqual([])
  expect(report.acknowledgements.map((violation) => violation.rule)).toEqual(["weakened-csp"])
})

test("ProductionChecker fails renderer raw bridge calls with file and line", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {},
      rendererFiles: [
        {
          path: "src/renderer/main.ts",
          content: ["import { Client } from '@effect-desktop/bridge'", "rawBridge.send({})"].join(
            "\n"
          )
        }
      ]
    })
  )

  expect(report.passed).toBe(false)
  expect(report.failures).toMatchObject([
    {
      rule: "raw-bridge-call",
      location: {
        path: "src/renderer/main.ts",
        line: 2
      }
    }
  ])
})

test("ProductionChecker fails filesystem writes without scoped roots", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        permissions: {
          filesystem: {
            write: {
              enabled: true
            }
          }
        }
      }
    })
  )

  expect(report.passed).toBe(false)
  expect(report.failures.map((violation) => violation.rule)).toEqual([
    "filesystem-write-without-scope"
  ])
})

test("ProductionChecker rule registry covers the current production rule set", async () => {
  const config: ProductionSecurityConfig = {
    security: {
      requireTypedBridge: false,
      rendererNativeAccess: true,
      requirePermissions: false,
      externalNavigation: "allow",
      csp: { disabled: true },
      redaction: { defaultPatternEnabled: false }
    },
    permissions: {
      filesystem: { write: { enabled: true } },
      process: { spawn: { enabled: true } },
      secrets: { read: ["auth"], audit: "never" }
    },
    update: { install: { enabled: true } },
    appProtocol: { allowPathTraversal: true },
    resources: { allowUnscoped: true },
    contracts: [
      {
        contract: "WebView.capture",
        capability: "screen-capture",
        support: "partial"
      }
    ]
  }

  const report = await Effect.runPromise(
    runProductionCheck({
      config,
      rendererFiles: [
        {
          path: "src/renderer/main.ts",
          content: [
            "import { Filesystem } from '@effect-desktop/core'",
            "HostProtocol.send({})",
            "sendRaw({})"
          ].join("\n")
        }
      ]
    })
  )

  expect(new Set(report.failures.map((violation) => violation.rule))).toEqual(
    new Set([
      "renderer-backend-import",
      "raw-bridge-call",
      "renderer-native-host-protocol",
      "filesystem-write-without-scope",
      "process-permission-without-policy",
      "secret-access-without-audit",
      "update-install-without-signature",
      "app-protocol-path-traversal",
      "weakened-csp",
      "unsafe-external-navigation",
      "unscoped-resource",
      "unsupported-capability-without-guard",
      "secret-pattern-not-redacted"
    ])
  )
})

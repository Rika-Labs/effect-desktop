import { expect, test } from "bun:test"
import { Effect } from "effect"

import {
  cspWeakenings,
  formatProductionCheckReport,
  renderDefaultCsp,
  renderEffectiveCsp,
  runProductionCheck,
  type ProductionSecurityConfig
} from "./index.js"

test("CSP defaults render the spec policy with a nonce", () => {
  expect(renderDefaultCsp("abc123")).toBe(
    [
      "default-src 'self'",
      "script-src 'self' 'nonce-abc123'",
      "style-src 'self' 'nonce-abc123'",
      "connect-src 'self' app:",
      "img-src 'self' app: data: https:",
      "font-src 'self' app: data:",
      "media-src 'self' app:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "worker-src 'self'"
    ].join("; ")
  )
})

test("CSP config can tighten a default directive", () => {
  const csp = { policy: "connect-src 'self'" }

  expect(cspWeakenings(csp)).toEqual([])
  expect(renderEffectiveCsp(csp, "abc123")).toContain("connect-src 'self';")
  expect(renderEffectiveCsp(csp, "abc123")).not.toContain("connect-src 'self' app:")
})

test("CSP config flags directive loosening beyond the default", () => {
  expect(cspWeakenings({ policy: "connect-src 'self' app: https:" })).toEqual([
    {
      directive: "connect-src",
      reason: "connect-src adds source https:"
    }
  ])
})

test("CSP config can add hardening-only directives", () => {
  const csp = { policy: "frame-src 'none'; upgrade-insecure-requests" }

  expect(cspWeakenings(csp)).toEqual([])
  expect(renderEffectiveCsp(csp, "abc123")).toContain("frame-src 'none'")
  expect(renderEffectiveCsp(csp, "abc123")).toContain("upgrade-insecure-requests")
})

test("CSP config flags unknown directives that add sources", () => {
  expect(cspWeakenings({ policy: "frame-src https:" })).toEqual([
    {
      directive: "frame-src",
      reason: "frame-src is not part of the default production CSP"
    }
  ])
})

test("CSP config flags duplicate directives", () => {
  expect(cspWeakenings({ policy: "script-src 'unsafe-inline'; script-src 'self'" })).toEqual([
    {
      directive: "script-src",
      reason: "script-src appears more than once"
    }
  ])
})

test("CSP config flags static nonces as weaker than request nonces", () => {
  expect(cspWeakenings({ policy: "script-src 'self' 'nonce-fixed'" })).toEqual([
    {
      directive: "script-src",
      reason: "script-src adds source 'nonce-fixed'"
    }
  ])
})

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

test("ProductionChecker accepts tightened CSP without acknowledgement", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        security: {
          csp: {
            policy: "connect-src 'self'"
          }
        }
      }
    })
  )

  expect(report.passed).toBe(true)
  expect(report.failures).toEqual([])
  expect(report.acknowledgements).toEqual([])
})

test("ProductionChecker fails CSP directive loosening without acknowledgement", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        security: {
          csp: {
            policy: "connect-src 'self' app: https:"
          }
        }
      }
    })
  )

  expect(report.passed).toBe(false)
  expect(report.failures).toMatchObject([
    {
      rule: "weakened-csp",
      message:
        "content security policy weakens the production default: connect-src adds source https:"
    }
  ])
})

test("ProductionChecker accepts hardening-only CSP additions", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        security: {
          csp: {
            policy: "frame-src 'none'; upgrade-insecure-requests"
          }
        }
      }
    })
  )

  expect(report.passed).toBe(true)
  expect(report.failures).toEqual([])
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

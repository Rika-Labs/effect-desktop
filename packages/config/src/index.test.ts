import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import {
  cspWeakenings,
  DEFAULT_CSP_DIRECTIVES,
  formatProductionCheckReport,
  ProductionCheckInvalidInput,
  renderDefaultCsp,
  renderEffectiveCsp,
  runProductionCheck,
  type ProductionSecurityConfig
} from "./index.js"

const HOST_DEFAULT_CSP_FOR_NONCE = (nonce: string): string =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
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

test("CSP defaults render the spec policy with a nonce", () => {
  expect(renderDefaultCsp("abc123")).toBe(HOST_DEFAULT_CSP_FOR_NONCE("abc123"))
})

test("CSP rendering rejects nonce tokens that can alter header structure", () => {
  for (const nonce of ["", "abc def", "abc'; default-src *; x='y", "abc\nx", 'abc"x']) {
    expect(() => renderDefaultCsp(nonce)).toThrow(TypeError)
    expect(() => renderEffectiveCsp({}, nonce)).toThrow(TypeError)
  }
})

test("CSP disabled config renders no effective CSP policy", () => {
  expect(renderEffectiveCsp({ disabled: true })).toBe("")
})

test("CSP config accepts the host/spec default policy without weakenings", () => {
  expect(cspWeakenings({ policy: HOST_DEFAULT_CSP_FOR_NONCE("{N}") })).toEqual([])
})

test("CSP disabled policy reports disabled weakening", () => {
  expect(cspWeakenings({ disabled: true })).toEqual([
    { directive: "security.csp.disabled", reason: "content security policy is disabled" }
  ])
})

test("CSP disabled is rejected by the production checker without acknowledgement", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        security: {
          csp: {
            disabled: true
          }
        }
      }
    })
  )

  expect(report.passed).toBe(false)
  expect(report.failures.map((violation) => violation.rule)).toEqual(["weakened-csp"])
  expect(report.failures[0]?.message).toContain("content security policy is disabled")
})

test("CSP config still rejects script-src 'unsafe-inline' as a weakening", () => {
  expect(cspWeakenings({ policy: "script-src 'self' 'unsafe-inline'" })).toEqual([
    {
      directive: "script-src",
      reason: "script-src includes forbidden source 'unsafe-inline'"
    }
  ])
})

test("CSP config still rejects style-src 'unsafe-inline' as a weakening", () => {
  expect(cspWeakenings({ policy: "style-src 'self' 'unsafe-inline'" })).toEqual([
    {
      directive: "style-src",
      reason: "style-src includes forbidden source 'unsafe-inline'"
    }
  ])
})

test("CSP config still rejects 'unsafe-eval' on any directive", () => {
  expect(cspWeakenings({ policy: "script-src 'self' 'unsafe-eval'" })).toEqual([
    {
      directive: "script-src",
      reason: "script-src includes forbidden source 'unsafe-eval'"
    }
  ])
})

test("DEFAULT_CSP_DIRECTIVES never permits 'unsafe-eval' on any directive", () => {
  const entriesWithUnsafeEval = DEFAULT_CSP_DIRECTIVES.filter(([, values]) =>
    values.includes("'unsafe-eval'")
  )
  expect(entriesWithUnsafeEval).toEqual([])
})

test("CSP config can tighten a default directive", () => {
  const csp = { policy: "connect-src 'self'" }

  expect(cspWeakenings(csp)).toEqual([])
  expect(renderEffectiveCsp(csp, "abc123")).toContain("connect-src 'self';")
  expect(renderEffectiveCsp(csp, "abc123")).not.toContain("connect-src 'self' app:")
})

test("CSP config normalizes mixed-case directive names", () => {
  const csp = { policy: "CONNECT-SRC 'self'" }

  expect(cspWeakenings(csp)).toEqual([])
  expect(renderEffectiveCsp(csp, "abc123")).toContain("connect-src 'self';")
  expect(renderEffectiveCsp(csp, "abc123")).not.toContain("CONNECT-SRC")
})

test("CSP config treats source-list overrides set to none as hardening", () => {
  expect(cspWeakenings({ policy: "script-src 'none'" })).toEqual([])
  expect(renderEffectiveCsp({ policy: "script-src 'none'" }, "abc123")).toContain(
    "script-src 'none'"
  )
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

test("CSP config detects mixed-case duplicate directives", () => {
  expect(cspWeakenings({ policy: "SCRIPT-SRC 'self'; script-src 'self'" })).toEqual([
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

test("ProductionChecker acknowledges devtools-in-prod because launch flag is still required", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        security: {
          devtoolsInProd: true
        }
      }
    })
  )

  expect(report.passed).toBe(true)
  expect(report.failures).toEqual([])
  expect(report.acknowledgements).toMatchObject([
    {
      rule: "devtools-in-prod",
      location: {
        path: "desktop.config.ts#security.devtoolsInProd"
      }
    }
  ])
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

test("ProductionChecker ignores raw bridge names inside comments", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {},
      rendererFiles: [
        {
          path: "src/renderer/main.ts",
          content: [
            "// Do not call sendRaw({}) from renderer code.",
            "/* rawBridge.send({}) and HostProtocol.send({}) are forbidden. */",
            "const client = makeClient()"
          ].join("\n")
        }
      ]
    })
  )

  expect(report.passed).toBe(true)
  expect(report.failures).toEqual([])
})

test("ProductionChecker fails unguarded source native capability usage", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {},
      rendererFiles: [
        {
          path: "src/renderer/dock.ts",
          content: "Dock.setJumpList([{ title: 'Recent', path: '/tmp/a' }])"
        }
      ]
    })
  )

  expect(report.passed).toBe(false)
  expect(report.failures).toMatchObject([
    {
      rule: "unsupported-capability-without-guard",
      location: {
        path: "src/renderer/dock.ts",
        line: 1,
        column: 1
      }
    }
  ])
})

test("ProductionChecker accepts guarded source native capability usage", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {},
      rendererFiles: [
        {
          path: "src/renderer/dock.ts",
          content: ['if (Dock.isSupported("setJumpList")) {', "  Dock.setJumpList([])", "}"].join(
            "\n"
          )
        }
      ]
    })
  )

  expect(report.failures.map((violation) => violation.rule)).not.toContain(
    "unsupported-capability-without-guard"
  )
  expect(report.passed).toBe(true)
})

test("ProductionChecker ignores source native capability usage inside comments", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {},
      rendererFiles: [
        {
          path: "src/renderer/dock.ts",
          content: [
            "// Dock.setJumpList([{ title: 'Recent', path: '/tmp/a' }])",
            "/* Dock.requestAttention() */",
            "const dockState = 'idle'"
          ].join("\n")
        }
      ]
    })
  )

  expect(report.passed).toBe(true)
  expect(report.failures).toEqual([])
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
      externalNavigation: "allow" as never,
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

test("ProductionChecker requires audit for wildcard secret reads", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        permissions: {
          secrets: {
            read: ["*"],
            audit: "never"
          }
        }
      }
    })
  )

  expect(report.passed).toBe(false)
  expect(report.failures.map((violation) => violation.rule)).toEqual([
    "secret-access-without-audit"
  ])
})

test("ProductionChecker requires audit for wildcard secret writes", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        permissions: {
          secrets: {
            write: ["*"]
          }
        }
      }
    })
  )

  expect(report.passed).toBe(false)
  expect(report.failures.map((violation) => violation.rule)).toEqual([
    "secret-access-without-audit"
  ])
})

test("ProductionChecker accepts missing secret audit when no secret access is declared", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        permissions: {
          secrets: {
            audit: "never"
          }
        }
      }
    })
  )

  expect(report.passed).toBe(true)
  expect(report.failures).toEqual([])
})

test("ProductionChecker accepts guarded partial OS-state contracts", async () => {
  const report = await Effect.runPromise(
    runProductionCheck({
      config: {
        contracts: [
          {
            contract: "Screen.getPointerPoint",
            capability: "native.invoke:Screen.getPointerPoint",
            support: "partial",
            isSupportedGuard: true
          },
          {
            contract: "PowerMonitor.onPowerSourceChanged",
            capability: "native.event:PowerMonitor.PowerSourceChanged",
            support: "partial",
            isSupportedGuard: true
          },
          {
            contract: "SystemAppearance.getAccentColor",
            capability: "native.invoke:SystemAppearance.getAccentColor",
            support: "unsupported",
            isSupportedGuard: true
          }
        ]
      }
    })
  )

  expect(report.failures.map((violation) => violation.rule)).not.toContain(
    "unsupported-capability-without-guard"
  )
})

test("ProductionChecker rejects empty config paths", async () => {
  const emptyExit = await Effect.runPromiseExit(
    runProductionCheck({
      configPath: "",
      config: {
        security: { externalNavigation: "deny" }
      } as never
    })
  )
  const whitespaceExit = await Effect.runPromiseExit(
    runProductionCheck({
      configPath: "   ",
      config: {
        security: { externalNavigation: "deny" }
      } as never
    })
  )
  const absentExit = await Effect.runPromiseExit(
    runProductionCheck({
      config: {
        security: { externalNavigation: "deny" }
      } as never
    })
  )

  expect(Exit.isFailure(emptyExit)).toBe(true)
  expect(Exit.isFailure(whitespaceExit)).toBe(true)
  expect(Exit.isSuccess(absentExit)).toBe(true)

  if (Exit.isFailure(emptyExit)) {
    const failReason = emptyExit.cause.reasons.find((r) => r._tag === "Fail")
    expect(failReason?.error).toBeInstanceOf(ProductionCheckInvalidInput)
  }
  if (Exit.isFailure(whitespaceExit)) {
    const failReason = whitespaceExit.cause.reasons.find((r) => r._tag === "Fail")
    expect(failReason?.error).toBeInstanceOf(ProductionCheckInvalidInput)
  }
})

test("ProductionChecker rejects malformed renderer file inputs", async () => {
  const exit = await Effect.runPromiseExit(
    runProductionCheck({
      config: {},
      rendererFiles: [{ path: "src/renderer/main.ts" } as never]
    })
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failReason = exit.cause.reasons.find((r) => r._tag === "Fail")
    expect(failReason?.error).toBeInstanceOf(ProductionCheckInvalidInput)
  }
})

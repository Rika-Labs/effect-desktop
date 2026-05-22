import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import {
  cspWeakenings,
  DEFAULT_CSP_DIRECTIVES,
  DEFAULT_CSP_POLICY,
  decodeDesktopConfig,
  defineDesktopConfig,
  effectiveCspPolicy,
  formatProductionCheckReport,
  makeCspNonce,
  mergeDesktopConfig,
  ProductionCheckInvalidInput,
  renderCspPolicy,
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

test("CSP defaults are schema-backed ordered policy data", () => {
  expect(DEFAULT_CSP_POLICY.directives.map((directive) => directive.name)).toEqual(
    DEFAULT_CSP_DIRECTIVES.map(([directive]) => directive)
  )
  expect(renderCspPolicy(DEFAULT_CSP_POLICY, makeCspNonce("abc123"))).toBe(
    HOST_DEFAULT_CSP_FOR_NONCE("abc123")
  )
})

test("defineDesktopConfig accepts the documented app config shape", () => {
  const config = defineDesktopConfig({
    app: {
      id: "dev.example.app",
      name: "Example App",
      version: "1.0.0"
    },
    runtime: {
      engine: "node",
      entry: "src/app.ts"
    },
    renderer: {
      framework: "react",
      styling: "tailwind",
      entry: "src/renderer/main.tsx"
    },
    web: {
      engine: "chrome"
    },
    native: {
      host: "rust-wry-tao",
      renderer: "system-webview"
    },
    windows: {
      defaults: {
        titleBarStyle: "default"
      }
    },
    security: {
      requireTypedBridge: true,
      rendererNativeAccess: false,
      requirePermissions: true,
      csp: undefined,
      externalNavigation: "deny",
      devtoolsInProd: false
    },
    protocols: [{ scheme: "myapp", handler: "open" }],
    build: {
      targets: ["macos-arm64", "linux-x64"]
    },
    signing: {
      macos: {
        identity: "Developer ID Application: Example Inc."
      }
    },
    update: {
      channel: "stable",
      publicKey: "ed25519:abc",
      feedUrl: "https://updates.example.dev/{platform}/{channel}.json",
      maxVersion: undefined,
      keyVersion: 2
    },
    telemetry: {
      enabled: true,
      redactSensitive: true,
      endpoint: "https://telemetry.example.dev"
    },
    protocol: {
      limits: {
        maxFrameBytes: 4 * 1024 * 1024,
        maxConcurrentRequestsPerWindow: 256,
        maxConcurrentStreamsPerWindow: 64
      }
    },
    env: {
      dev: { LOG_LEVEL: "debug" }
    },
    workspace: {
      sharedConfigPath: "../../desktop.shared.ts"
    }
  })

  expect(config.app.version).toBe("1.0.0")
  expect(config.runtime.engine).toBe("node")
  expect(config.web.engine).toBe("chrome")
})

test("defineDesktopConfig rejects invalid app metadata types at compile time", () => {
  const config = defineDesktopConfig({
    app: {
      id: "dev.example.app",
      name: "Example App",
      // @ts-expect-error app.version must be a string when present.
      version: 1
    }
  })

  expect(config.app?.id).toBe("dev.example.app")
})

test("decodeDesktopConfig accepts schema-coded windows and signing config", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* decodeDesktopConfig({
        app: { id: "dev.example.app", name: "Example", version: "1.0.0" },
        signing: {
          macos: {
            identity: "Developer ID Application: Example Inc."
          }
        },
        windows: [
          {
            height: 768,
            id: "main",
            title: "Main",
            width: 1024
          }
        ]
      })

      expect(Array.isArray(config.windows)).toBe(true)
      expect(config.signing).toEqual({
        macos: {
          identity: "Developer ID Application: Example Inc."
        }
      })
    })
  ))

test("decodeDesktopConfig defaults web engine to system when web config is present", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* decodeDesktopConfig({
        web: {}
      })

      expect(config.web?.engine).toBe("system")
    })
  ))

test("decodeDesktopConfig normalizes legacy chromium web engine to chrome", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* decodeDesktopConfig({
        web: { engine: "chromium" }
      })

      expect(config.web?.engine).toBe("chrome")
    })
  ))

test("decodeDesktopConfig rejects non-json windows and signing values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const invalid of [
        { windows: "main" },
        { signing: "Developer ID Application: Example Inc." },
        { windows: [{ id: "main", onOpen: () => undefined }] }
      ]) {
        const exit = yield* Effect.exit(decodeDesktopConfig(invalid))
        expect(Exit.isFailure(exit)).toBe(true)
      }
    })
  ))

test("mergeDesktopConfig combines decoded shared and app config by typed policy", () => {
  const merged = mergeDesktopConfig(
    {
      app: { id: "shared", name: "Shared", version: "1.0.0" },
      env: { dev: { OVERRIDE: "shared", SHARED: "1" } },
      protocol: { limits: { maxFrameBytes: 1024 } },
      web: { engine: "system" },
      signing: { macos: { identity: "shared" } },
      windows: { defaults: { titleBarStyle: "default" } }
    },
    {
      app: { id: "app" },
      env: { dev: { OVERRIDE: "app" } },
      protocol: { limits: { maxConcurrentRequestsPerWindow: 4 } },
      web: { engine: "chromium" },
      windows: [{ id: "main" }]
    }
  )

  expect(merged.app).toEqual({ id: "app", name: "Shared", version: "1.0.0" })
  expect(merged.env).toEqual({ dev: { OVERRIDE: "app", SHARED: "1" } })
  expect(merged.protocol?.limits).toEqual({
    maxConcurrentRequestsPerWindow: 4,
    maxFrameBytes: 1024
  })
  expect(merged.web).toEqual({ engine: "chrome" })
  expect(merged.signing).toEqual({ macos: { identity: "shared" } })
  expect(merged.windows).toEqual([{ id: "main" }])
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

test("CSP disabled is rejected by the production checker without acknowledgement", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          security: {
            csp: {
              disabled: true
            }
          }
        }
      })

      expect(report.passed).toBe(false)
      expect(report.failures.map((violation) => violation.rule)).toEqual(["weakened-csp"])
      expect(report.failures[0]?.message).toContain("content security policy is disabled")
    })
  ))

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
  expect(
    effectiveCspPolicy(csp).directives.find((directive) => directive.name === "connect-src")
  ).toMatchObject({ values: ["'self'"] })
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
  const csp = { policy: "frame-src 'none'; upgrade-insecure-requests; block-all-mixed-content" }

  expect(cspWeakenings(csp)).toEqual([])
  expect(renderEffectiveCsp(csp, "abc123")).toContain("frame-src 'none'")
  expect(renderEffectiveCsp(csp, "abc123")).toContain("upgrade-insecure-requests")
  expect(renderEffectiveCsp(csp, "abc123")).toContain("block-all-mixed-content")
})

test("CSP hardening classification uses one directive semantics table", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(new URL("index.ts", import.meta.url)).text()
      )

      expect(source).toContain("CSP_DIRECTIVE_SEMANTICS")
      expect(source).not.toContain("NO_VALUE_HARDENING_CSP_DIRECTIVES")
      expect(source).not.toContain("VALUE_HARDENING_CSP_DIRECTIVES")
    })
  ))

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

test("ProductionChecker fails unsafe CSP without acknowledgement", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        configPath: "desktop.config.ts",
        config: {
          security: {
            csp: {
              policy: "default-src 'self'; script-src 'self' 'unsafe-inline'"
            }
          }
        }
      })

      expect(report.passed).toBe(false)
      expect(report.failures.map((violation) => violation.rule)).toEqual(["weakened-csp"])
      expect(formatProductionCheckReport(report)).toContain("security.csp")
    })
  ))

test("ProductionChecker accepts tightened CSP without acknowledgement", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          security: {
            csp: {
              policy: "connect-src 'self'"
            }
          }
        }
      })

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
      expect(report.acknowledgements).toEqual([])
    })
  ))

test("ProductionChecker fails CSP directive loosening without acknowledgement", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          security: {
            csp: {
              policy: "connect-src 'self' app: https:"
            }
          }
        }
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "weakened-csp",
          message:
            "content security policy weakens the production default: connect-src adds source https:"
        }
      ])
    })
  ))

test("ProductionChecker accepts hardening-only CSP additions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          security: {
            csp: {
              policy: "frame-src 'none'; upgrade-insecure-requests"
            }
          }
        }
      })

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker accepts Trusted Types CSP enforcement as hardening", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          security: {
            csp: {
              policy: "require-trusted-types-for 'script'"
            }
          }
        }
      })

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker rejects invalid Trusted Types CSP enforcement values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          security: {
            csp: {
              policy: "require-trusted-types-for 'none'"
            }
          }
        }
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "weakened-csp",
          message:
            "content security policy weakens the production default: require-trusted-types-for is not part of the default production CSP"
        }
      ])
    })
  ))

test("ProductionChecker reports acknowledged CSP weakenings without failing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
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

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
      expect(report.acknowledgements.map((violation) => violation.rule)).toEqual(["weakened-csp"])
    })
  ))

test("ProductionChecker acknowledges devtools-in-prod because launch flag is still required", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          security: {
            devtoolsInProd: true
          }
        }
      })

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
  ))

test("ProductionChecker fails renderer raw bridge calls with file and line", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/main.ts",
            content: ["import { Client } from '@orika/bridge'", "rawBridge.send({})"].join("\n")
          }
        ]
      })

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
  ))

test("ProductionChecker ignores raw bridge names inside comments", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
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

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker blocks host protocol symbols imported from the bridge barrel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/main.ts",
            content: [
              "import { HostProtocolRequestEnvelope } from '@orika/bridge'",
              "new HostProtocolRequestEnvelope({ id: '1' })"
            ].join("\n")
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "renderer-native-host-protocol",
          location: {
            path: "src/renderer/main.ts",
            line: 1
          }
        }
      ])
    })
  ))

test("ProductionChecker still blocks bridge protocol subpath imports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/main.ts",
            content: "import { HostProtocolRequestEnvelope } from '@orika/bridge/protocol'"
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures.map((violation) => violation.rule)).toEqual([
        "renderer-native-host-protocol"
      ])
    })
  ))

test("ProductionChecker allows renderer-safe bridge barrel imports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/main.ts",
            content: "import { Client } from '@orika/bridge'"
          }
        ]
      })

      expect(report.passed).toBe(true)
    })
  ))

test("ProductionChecker fails unguarded source native capability usage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: "Dock.setJumpList([{ title: 'Recent', path: '/tmp/a' }])"
          }
        ]
      })

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
  ))

test("ProductionChecker accepts guarded source native capability usage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
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

      expect(report.failures.map((violation) => violation.rule)).not.toContain(
        "unsupported-capability-without-guard"
      )
      expect(report.passed).toBe(true)
    })
  ))

test("ProductionChecker rejects source native capability usage after a closed guard block", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: [
              'if (Dock.isSupported("setJumpList")) {',
              "  console.info('supported')",
              "}",
              "Dock.setJumpList([])"
            ].join("\n")
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 4,
            column: 1
          }
        }
      ])
    })
  ))

test("ProductionChecker rejects source native capability usage after non-code guard text", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: [
              'const fake = `if (Dock.isSupported("setJumpList"))`',
              "{",
              "  Dock.setJumpList([])",
              "}"
            ].join("\n")
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 3,
            column: 3
          }
        }
      ])
    })
  ))

test("ProductionChecker rejects source native capability usage inside a negated guard block", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: [
              'if (!Dock.isSupported("setJumpList")) {',
              "  Dock.setJumpList([])",
              "}"
            ].join("\n")
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 2,
            column: 3
          }
        }
      ])
    })
  ))

test("ProductionChecker flags unguarded partial Dock badge count usage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: "Dock.setBadgeCount(7)"
          }
        ]
      })

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
  ))

test("ProductionChecker flags unguarded unsupported Dock progress usage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: "Dock.setProgress(0.5)"
          }
        ]
      })

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
  ))

test("ProductionChecker flags unguarded partial realtime media session usage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/media.ts",
            content: 'RealtimeMediaSession.open({ profileId: "p1", sessionId: "s1" })'
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/media.ts",
            line: 1,
            column: 1
          }
        }
      ])
    })
  ))

test("ProductionChecker accepts diagnostics bundle usage as a supported native capability", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/diagnostics.ts",
            content: 'DiagnosticsBundle.collect({ bundleId: "bundle-1" })'
          }
        ]
      })

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker accepts supported Dock requestAttention without a guard", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: "Dock.requestAttention()"
          }
        ]
      })

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker ignores source native capability usage inside comments", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
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

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker ignores source native capability usage inside strings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: [
              'const snippet = "Dock.setJumpList([])"',
              "const template = `Dock.setJumpList([])`",
              'const block = "{ not a source block }"'
            ].join("\n")
          }
        ]
      })

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker ignores source native capability text inside array strings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: 'const snippets = ["Dock.setJumpList([])"]'
          }
        ]
      })

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker flags source native capability usage inside template expressions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: "const label = `${Dock.setJumpList([])}`"
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 1,
            column: 18
          }
        }
      ])
    })
  ))

test("ProductionChecker flags source native capability usage through optional chaining", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: ["Dock?.setJumpList([])", "Dock.setJumpList?.([])"].join("\n")
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 1,
            column: 1
          }
        },
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 2,
            column: 1
          }
        }
      ])
    })
  ))

test("ProductionChecker flags source native capability usage through computed literal calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: ['Dock["setJumpList"]([])', 'Dock?.["setJumpList"]([])'].join("\n")
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 1,
            column: 1
          }
        },
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 2,
            column: 1
          }
        }
      ])
    })
  ))

test("ProductionChecker flags source native capability method extraction", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: [
              "const setJumpList = Dock.setJumpList",
              "const setJumpListComputed = Dock[\"setJumpList\"]",
              "setJumpList([])",
              "setJumpListComputed([])"
            ].join("\n")
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 1,
            column: 21
          }
        },
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 2,
            column: 29
          }
        }
      ])
    })
  ))

test("ProductionChecker accepts guarded source native capability usage inside template expressions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: [
              'if (Dock.isSupported("setJumpList")) {',
              "  const label = `${Dock.setJumpList([])}`",
              "}"
            ].join("\n")
          }
        ]
      })

      expect(report.failures.map((violation) => violation.rule)).not.toContain(
        "unsupported-capability-without-guard"
      )
      expect(report.passed).toBe(true)
    })
  ))

test("ProductionChecker flags template expression native capability usage after regex brace literals", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {},
        rendererFiles: [
          {
            path: "src/renderer/dock.ts",
            content: "const label = `${(name.match(/}/), Dock.setJumpList([]))}`"
          }
        ]
      })

      expect(report.passed).toBe(false)
      expect(report.failures).toMatchObject([
        {
          rule: "unsupported-capability-without-guard",
          location: {
            path: "src/renderer/dock.ts",
            line: 1,
            column: 36
          }
        }
      ])
    })
  ))

test("ProductionChecker fails filesystem writes without scoped roots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
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

      expect(report.passed).toBe(false)
      expect(report.failures.map((violation) => violation.rule)).toEqual([
        "filesystem-write-without-scope"
      ])
    })
  ))

test("ProductionChecker rejects blank and wildcard-shaped permission scopes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const roots of [[""], [" * "]]) {
        const report = yield* runProductionCheck({
          config: {
            permissions: {
              filesystem: {
                write: {
                  enabled: true,
                  roots
                }
              }
            }
          }
        })

        expect(report.failures.map((violation) => violation.rule)).toContain(
          "filesystem-write-without-scope"
        )
      }

      const processReport = yield* runProductionCheck({
        config: {
          permissions: {
            process: {
              spawn: {
                enabled: true,
                allow: [" * "]
              }
            }
          }
        }
      })
      const scopedReport = yield* runProductionCheck({
        config: {
          permissions: {
            filesystem: {
              write: {
                enabled: true,
                roots: ["/tmp/app"]
              }
            },
            process: {
              spawn: {
                enabled: true,
                allow: ["git"]
              }
            }
          }
        }
      })

      expect(processReport.failures.map((violation) => violation.rule)).toContain(
        "process-permission-without-policy"
      )
      expect(scopedReport.failures.map((violation) => violation.rule)).not.toContain(
        "filesystem-write-without-scope"
      )
      expect(scopedReport.failures.map((violation) => violation.rule)).not.toContain(
        "process-permission-without-policy"
      )
    })
  ))

test("ProductionChecker rule registry covers the current production rule set", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const report = yield* runProductionCheck({
        config,
        rendererFiles: [
          {
            path: "src/renderer/main.ts",
            content: [
              "import { Filesystem } from '@orika/core'",
              "HostProtocol.send({})",
              "sendRaw({})"
            ].join("\n")
          }
        ]
      })

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
  ))

test("ProductionChecker requires audit for wildcard secret reads", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          permissions: {
            secrets: {
              read: ["*"],
              audit: "never"
            }
          }
        }
      })

      expect(report.passed).toBe(false)
      expect(report.failures.map((violation) => violation.rule)).toEqual([
        "secret-access-without-audit"
      ])
    })
  ))

test("ProductionChecker requires audit for wildcard secret writes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          permissions: {
            secrets: {
              write: ["*"]
            }
          }
        }
      })

      expect(report.passed).toBe(false)
      expect(report.failures.map((violation) => violation.rule)).toEqual([
        "secret-access-without-audit"
      ])
    })
  ))

test("ProductionChecker accepts missing secret audit when no secret access is declared", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
        config: {
          permissions: {
            secrets: {
              audit: "never"
            }
          }
        }
      })

      expect(report.passed).toBe(true)
      expect(report.failures).toEqual([])
    })
  ))

test("ProductionChecker accepts guarded partial OS-state contracts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* runProductionCheck({
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

      expect(report.failures.map((violation) => violation.rule)).not.toContain(
        "unsupported-capability-without-guard"
      )
    })
  ))

test("ProductionChecker rejects empty config paths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const emptyExit = yield* Effect.exit(
        runProductionCheck({
          configPath: "",
          config: {
            security: { externalNavigation: "deny" }
          }
        })
      )
      const whitespaceExit = yield* Effect.exit(
        runProductionCheck({
          configPath: "   ",
          config: {
            security: { externalNavigation: "deny" }
          }
        })
      )
      const absentExit = yield* Effect.exit(
        runProductionCheck({
          config: {
            security: { externalNavigation: "deny" }
          }
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
  ))

test("ProductionChecker rejects malformed renderer file inputs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        runProductionCheck({
          config: {},
          rendererFiles: [{ path: "src/renderer/main.ts" }]
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failReason = exit.cause.reasons.find((r) => r._tag === "Fail")
        expect(failReason?.error).toBeInstanceOf(ProductionCheckInvalidInput)
      }
    })
  ))

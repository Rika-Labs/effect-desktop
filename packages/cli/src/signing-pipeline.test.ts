import { expect, test } from "bun:test"

import { Effect, Exit } from "effect"

import { decodeDesktopConfig } from "@orika/config"

import { macosEntitlementsPlist } from "./signing-pipeline.js"

const decodeConfig = (input: unknown) =>
  Effect.runPromise(decodeDesktopConfig(input, "signing-pipeline.test config"))

test("macosEntitlementsPlist accepts the structured permissions object form", async () => {
  const config = await decodeConfig({
    permissions: { filesystem: { write: { enabled: true } } }
  })

  const exit = await Effect.runPromise(Effect.exit(macosEntitlementsPlist(config)))

  expect(Exit.isSuccess(exit)).toBe(true)
  const entitlements = exit._tag === "Success" ? exit.value : ""
  expect(entitlements).toContain("<key>com.apple.security.device.camera</key>\n  <false/>")
  expect(entitlements).toContain("<key>com.apple.security.device.microphone</key>\n  <false/>")
  expect(entitlements).toContain("<key>com.apple.security.network.client</key>\n  <false/>")
})

test("macosEntitlementsPlist treats an empty structured permissions object as no capabilities", async () => {
  const config = await decodeConfig({ permissions: {} })

  const exit = await Effect.runPromise(Effect.exit(macosEntitlementsPlist(config)))

  expect(Exit.isSuccess(exit)).toBe(true)
  const entitlements = exit._tag === "Success" ? exit.value : ""
  expect(entitlements).toContain("<key>com.apple.security.device.camera</key>\n  <false/>")
  expect(entitlements).toContain("<key>com.apple.security.network.client</key>\n  <false/>")
})

test("macosEntitlementsPlist extracts capabilities from the array permissions form", async () => {
  const config = await decodeConfig({
    permissions: ["device.camera", "network.client"]
  })

  const exit = await Effect.runPromise(Effect.exit(macosEntitlementsPlist(config)))

  expect(Exit.isSuccess(exit)).toBe(true)
  const entitlements = exit._tag === "Success" ? exit.value : ""
  expect(entitlements).toContain("<key>com.apple.security.device.camera</key>\n  <true/>")
  expect(entitlements).toContain("<key>com.apple.security.device.microphone</key>\n  <false/>")
  expect(entitlements).toContain("<key>com.apple.security.network.client</key>\n  <true/>")
})

test("macosEntitlementsPlist rejects malformed entries in the array permissions form", async () => {
  const config = await decodeConfig({ permissions: [42] })

  const exit = await Effect.runPromise(Effect.exit(macosEntitlementsPlist(config)))

  expect(Exit.isFailure(exit)).toBe(true)
})

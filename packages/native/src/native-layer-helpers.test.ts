import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { expect, test } from "bun:test"

const SourceDir = import.meta.dir

const AllowedServiceLayerHelpers = new Set([
  "makeAttachmentIntakeServiceLayer",
  "makeCrashReporterServiceLayer",
  "makeDiagnosticsBundleServiceLayer",
  "makeDisplayCaptureServiceLayer",
  "makeDistributionParityServiceLayer",
  "makeEgressPolicyServiceLayer",
  "makeExtensionConfigServiceLayer",
  "makeExtensionPackageServiceLayer",
  "makeJobServiceLayer",
  "makeLocalToolRuntimeServiceLayer",
  "makeNotificationServiceLayer",
  "makeResidentLifecycleServiceLayer",
  "makeTransactionalFileMutationServiceLayer",
  "makeTrayServiceLayer",
  "makeWorkspaceIndexServiceLayer"
])

const AllowedBridgeClientLayerHelpers = new Set([
  "makeScreenBridgeClientLayer",
  "makeWindowBridgeClientLayer"
])

const LayerHelperExportPattern =
  /\b(?:export\s+const|export\s*\{[^}]*?)\s+(make[A-Za-z0-9]+(?:ClientLayer|ServiceLayer|BridgeClientLayer))\b/g

const collectSourceFiles = async (directory: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path)
    }
  }

  return files
}

test("native public layer helper exports stay limited to policy-bearing helpers", async () => {
  const violations: string[] = []

  for (const file of await collectSourceFiles(SourceDir)) {
    const source = await readFile(file, "utf8")
    for (const match of source.matchAll(LayerHelperExportPattern)) {
      const helper = match[1]
      if (helper === undefined) {
        continue
      }

      if (helper.endsWith("BridgeClientLayer")) {
        if (!AllowedBridgeClientLayerHelpers.has(helper)) {
          violations.push(`${file}: remove ${helper}; use Surface.bridgeClientLayer directly`)
        }
        continue
      }

      if (helper.endsWith("ClientLayer")) {
        violations.push(`${file}: remove ${helper}; use Layer.succeed(Service)(client) directly`)
        continue
      }

      if (helper.endsWith("ServiceLayer") && !AllowedServiceLayerHelpers.has(helper)) {
        violations.push(`${file}: remove ${helper}; use Service.layer with Layer.succeed directly`)
      }
    }
  }

  expect(violations).toEqual([])
})

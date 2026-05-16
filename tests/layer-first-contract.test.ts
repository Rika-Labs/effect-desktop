import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..")
const CONTRACT_PATH = join(REPO_ROOT, "engineering", "architecture", "layer-first-contract.md")
const README_PATH = join(REPO_ROOT, "README.md")
const AGENTS_PATH = join(REPO_ROOT, "AGENTS.md")

describe("Layer-first framework contract", () => {
  test("documents a concrete review checklist for public effectful capabilities", () => {
    const contract = readFileSync(CONTRACT_PATH, "utf8")

    for (const required of [
      "Effect.Effect<A, E, R>",
      "Context.Service",
      "Live layer",
      "Client layer",
      "Test layer",
      "Schema.Class",
      "tagged errors",
      "ManagedRuntime",
      "Review checklist"
    ]) {
      expect(contract).toContain(required)
    }

    expect(contract).not.toContain("Effect.Service")
  })

  test("README and AGENTS point contributors at the canonical contract", () => {
    const readme = readFileSync(README_PATH, "utf8")
    const agents = readFileSync(AGENTS_PATH, "utf8")

    expect(readme).toContain("engineering/architecture/layer-first-contract.md")
    expect(agents).toContain("engineering/architecture/layer-first-contract.md")
  })
})

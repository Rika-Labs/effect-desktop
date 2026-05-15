import { defineConfig } from "oxlint"
import core from "ultracite/oxlint/core"

const disabledUltraciteCoreRules = Object.fromEntries(
  Object.keys(core.rules ?? {}).map((rule) => [rule, "off"])
)

export default defineConfig({
  extends: [core],
  plugins: ["typescript", "unicorn", "import", "oxc", "promise"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
    pedantic: "off",
    style: "off",
    restriction: "off",
    nursery: "off"
  },
  options: {
    typeAware: true,
    typeCheck: true
  },
  env: {
    es2024: true,
    node: true
  },
  rules: {
    ...disabledUltraciteCoreRules,

    "no-console": "error",
    "no-debugger": "error",
    eqeqeq: ["error", "always"],

    "typescript/no-explicit-any": "warn",
    "typescript/no-floating-promises": "warn",
    "typescript/no-misused-promises": "warn",
    "typescript/await-thenable": "warn",
    "typescript/switch-exhaustiveness-check": "warn",
    "typescript/no-unsafe-argument": "warn",
    "typescript/no-unsafe-assignment": "warn",
    "typescript/no-unsafe-call": "warn",
    "typescript/no-unsafe-return": "warn",
    "typescript/no-unsafe-member-access": "warn",
    "typescript/no-unnecessary-type-assertion": "warn",

    "import/no-cycle": "warn",
    "import/no-self-import": "warn",
    "import/no-duplicates": "warn"
  },
  overrides: [
    {
      files: ["**/bin.ts", "scripts/**/*.ts", "scripts/**/*.js"],
      rules: {
        "no-console": "off"
      }
    },
    {
      files: ["**/*.test.ts", "tests/**/*.ts"],
      rules: {
        "typescript/no-explicit-any": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-argument": "off"
      }
    }
  ],
  ignorePatterns: [
    "node_modules",
    "dist",
    "**/dist",
    "**/dist/**",
    "build",
    "target",
    ".turbo",
    "coverage",
    "engineering/SPEC.md",
    "repos",
    "repos/**"
  ]
})

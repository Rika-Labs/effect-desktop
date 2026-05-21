export default {
  app: {
    id: "dev.effect-desktop.inspector",
    name: "ORIKA Inspector",
    version: "0.0.0"
  },
  runtime: {
    entry: "../../packages/core/src/runtime/main.ts"
  },
  renderer: {
    dist: "dist"
  }
} as const

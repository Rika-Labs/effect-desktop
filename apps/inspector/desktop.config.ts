export default {
  app: {
    id: "dev.effect-desktop.inspector",
    name: "ORIKA Inspector",
    version: "0.0.0"
  },
  runtime: {
    entry: "src/runtime/main.ts"
  },
  renderer: {
    entry: "src/main.tsx",
    dist: "dist"
  },
  windows: {
    main: {
      title: "ORIKA Inspector",
      width: 1100,
      height: 760,
      route: "/"
    }
  }
} as const

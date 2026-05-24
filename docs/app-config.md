---
title: App config
description: defineDesktopConfig, schema, production checks.
kind: reference
audience: app-developers
effect_version: 4
---

# App config

> The full reference lives at [`reference/config.md`](reference/config.md). This page is the release-gated summary.

`desktop.config.ts` describes the app identity, renderer output, native host paths, windows, permissions, update policy, telemetry, and release/security checks.

## Define config

```ts
import { defineDesktopConfig } from "@orika/config"

export default defineDesktopConfig({
  app: {
    id: "dev.example.app",
    name: "Example",
    version: "0.1.0"
  },
  renderer: {
    framework: "react",
    styling: "tailwind",
    entry: "src/App.tsx",
    dist: "dist"
  }
})
```

`renderer.framework` defaults to `"react"` and accepts `"react"`, `"solid"`, or `"vue"`. The value is recorded in build cache keys and reports; the app still owns its Vite plugin and renderer build script.

## Verify Config Helper

```ts run
import { defineDesktopConfig } from "../packages/config/src/index.js"

const config = defineDesktopConfig({ app: { id: "dev.example.app" } })

if (config.app?.id !== "dev.example.app") {
  throw new Error("defineDesktopConfig failed")
}
```

## Production checks

The config package owns 14 production security check rules — typed bridge enforcement, raw native access detection, permission policies, CSP weakening acknowledgements, updater signature policy, resource scope checks. See [Configuration reference](reference/config.md) for the full list.

Run them via:

```bash
bun run desktop check --config desktop.config.ts
```

## Where to go next

- [Configuration reference](reference/config.md) — every field and rule
- [Tutorial: package, sign, and ship](tutorials/04-package-and-sign.md)
- [How-to: package for macOS](how-to/package-for-macos.md)

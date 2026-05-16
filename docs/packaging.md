---
title: Packaging
description: Stage platform artifacts from build outputs.
kind: reference
audience: app-developers
effect_version: 4
---

# Packaging

> Full reference: [`reference/cli.md`](reference/cli.md). Tutorial: [`package, sign, and ship`](tutorials/04-package-and-sign.md).

Packaging turns renderer output, runtime code, native host artifacts, app metadata, and release manifests into platform artifacts.

## CLI

```bash
bun run desktop package --config desktop.config.ts
```

The package command owns artifact staging and platform-specific tool invocation through typed runners.

## Verify Package Exports

```ts run
import { runDesktopPackage } from "../packages/cli/src/index.js"

const command = "desktop package"

if (typeof runDesktopPackage !== "function" || command.length === 0) {
  throw new Error("runDesktopPackage is unavailable")
}
```

## Rule

Package the **exact** artifact set consumed by signing, notarization, publishing, and reproducibility checks. Artifact identity is release evidence — every report carries `{ path, kind, size, hash }`.

## Where to go next

- [Tutorial: package, sign, and ship](tutorials/04-package-and-sign.md)
- [How-to: package for macOS](how-to/package-for-macos.md)
- [CLI reference](reference/cli.md)

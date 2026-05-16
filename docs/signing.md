---
title: Signing
description: Apply platform signatures to release artifacts.
kind: reference
audience: app-developers
effect_version: 4
---

# Signing

> Full reference: [`reference/cli.md`](reference/cli.md). How-to: [`sign and notarize`](how-to/sign-and-notarize.md).

Signing applies platform-specific signatures to release artifacts. It is **separate from packaging and publishing** so each phase has explicit evidence.

## CLI

```bash
bun run desktop sign --config desktop.config.ts
```

The sign command owns `codesign`, `signtool`, PowerShell unblock handling, and `gpg` invocation through injectable command runners.

## Verify Signing Exports

```ts run
import { runDesktopSign } from "../packages/cli/src/index.js"

const command = "desktop sign"

if (typeof runDesktopSign !== "function" || command.length === 0) {
  throw new Error("runDesktopSign is unavailable")
}
```

## Rule

Do not treat unsigned artifacts as releasable. Key custody and release signing evidence live under `engineering/security`.

## Where to go next

- [How-to: sign and notarize](how-to/sign-and-notarize.md)
- [How-to: package for macOS](how-to/package-for-macos.md)
- [Tutorial: package, sign, and ship](tutorials/04-package-and-sign.md)
- [CLI reference](reference/cli.md)

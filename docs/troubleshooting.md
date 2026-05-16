---
title: Troubleshooting
description: Typed errors and `desktop doctor` to find the failing path fast.
kind: reference
audience: app-developers
effect_version: 4
---

# Troubleshooting

> Full reference: [`reference/errors.md`](reference/errors.md). How-to: [`diagnose with doctor`](how-to/diagnose-with-doctor.md).

Effect Desktop failures are typed and observable. Start with the narrowest command that exercises the failing path.

## CLI fails before running

```bash
bun run desktop doctor
```

Then inspect the typed error tag. CLI errors preserve the failing path, operation, command, or config key.

## Bridge call fails

Check the RPC method name, schema input, host support metadata, permission policy, and bridge stream lifecycle. Unsupported platform behavior returns a typed unsupported result, not a thrown exception.

## Verify Doctor Exports

```ts run
import { DoctorMissing, runDesktopDoctor } from "../packages/cli/src/index.js"

if (DoctorMissing === undefined || typeof runDesktopDoctor !== "function") {
  throw new Error("DoctorMissing or runDesktopDoctor is unavailable")
}
```

## Debug rule

**Do not swallow errors.** Keep the original tag, path, command, stderr, and recovery guidance visible.

## Where to go next

- [How-to: diagnose with doctor](how-to/diagnose-with-doctor.md)
- [Errors catalog](reference/errors.md)
- [CLI reference](reference/cli.md)

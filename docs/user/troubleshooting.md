# Troubleshooting

Troubleshooting starts from typed error tags, doctor probes, logs, traces, and reproducible checks.

## Runnable Example

```ts run
import { DoctorMissing, runDesktopDoctor } from "../packages/cli/src/index.js"

if (DoctorMissing === undefined || typeof runDesktopDoctor !== "function") {
  throw new Error("doctor troubleshooting surface is unavailable")
}
```

# Issue 102 Address

## Triage Table

| #   | Comment                                                                               | Verdict | Reason / fix                                                                                                                     |
| --- | ------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Windows dark mode is forced on instead of following `SystemAppearance.getAppearance`. | Address | DWM dark-mode value now derives from Tao's current `Window::theme()`, with tests for light and dark mapping.                     |
| 2   | AppUserModelID is optional via an env var that the packaging path does not set.       | Address | Host now falls back from `EFFECT_DESKTOP_APP_ID` to the packaged `app-manifest.json` next to the host layout, then validates id. |
| 3   | Treat pre-set DPI awareness as non-fatal.                                             | Address | `ERROR_ACCESS_DENIED` from `SetProcessDpiAwarenessContext` now logs and continues because DPI awareness is already configured.   |
| 4   | Avoid hard-failing on unsupported dark-mode window attr.                              | Address | `DwmSetWindowAttribute` dark-mode failures now log and continue so unsupported polish does not prevent valid window creation.    |
| 5   | Continue process polish after DPI access-denied.                                      | Address | The DPI access-denied branch no longer returns early, so AppUserModelID is still applied after logging the pre-set DPI state.    |

## Commits Made

- `6328df9` — addressed dark-mode source and AppUserModelID source review.
- `f193462` — hardened DPI and DWM dark-mode compatibility review.
- `15bf994` — continued AppUserModelID application after pre-set DPI awareness.

## Escalations

None.

## Pushbacks

None.

## Follow-Up Issues

None.

## CI Status

Blacksmith CI after final address push:

- `validate (blacksmith-2vcpu-ubuntu-2404)` — passed.
- `validate (blacksmith-2vcpu-windows-2025)` — passed.
- `validate (blacksmith-6vcpu-macos-latest)` — passed.

## Open Threads

All addressed threads were resolved silently after the fix commits were pushed.

## Handoff

Comments addressed. Continue to `/learn` after CI passes.

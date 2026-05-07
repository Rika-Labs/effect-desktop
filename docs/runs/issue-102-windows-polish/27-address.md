# Issue 102 Address

## Triage Table

| #   | Comment                                                                               | Verdict | Reason / fix                                                                                                                     |
| --- | ------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Windows dark mode is forced on instead of following `SystemAppearance.getAppearance`. | Address | DWM dark-mode value now derives from Tao's current `Window::theme()`, with tests for light and dark mapping.                     |
| 2   | AppUserModelID is optional via an env var that the packaging path does not set.       | Address | Host now falls back from `EFFECT_DESKTOP_APP_ID` to the packaged `app-manifest.json` next to the host layout, then validates id. |

## Commits Made

- Pending commit: address Windows polish review.

## Escalations

None.

## Pushbacks

None.

## Follow-Up Issues

None.

## CI Status

Pending after push.

## Open Threads

The addressed threads will be resolved silently after the fix commit is pushed.

## Handoff

Comments addressed. Continue to `/learn` after CI passes.

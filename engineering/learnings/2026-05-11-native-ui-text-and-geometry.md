# Native UI Text And Geometry

## Planned

Close native UI validation gaps for context-menu geometry, tray tooltip text, and notification text.

## Shipped

The current context-menu and tray schemas already reject non-finite coordinates and empty tooltip updates at the bridge boundary. Notification show payloads now use non-empty printable text for both title and body, with regression coverage for empty title and empty body.

## Review Surface

The host protocol shape did not change. The accepted value domain narrowed so native adapters only receive finite coordinates and intentional user-visible text.

## Non-Obvious Lesson

Native UI contracts should validate accessibility-relevant text before dispatch. Leaving empty strings to platform adapters creates inconsistent behavior exactly where users need predictable affordances.

## AGENTS.md Amendment Candidate

None.

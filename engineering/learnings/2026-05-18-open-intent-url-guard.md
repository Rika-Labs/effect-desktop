# Open Intent URL Guard

Issue #1337 still requires real OS open-file and open-url event delivery. The safe incremental step was to tighten the renderer-visible open-url contract before a native event source exists.

`AppOpenUrlEvent` now requires a syntactically valid URL with no ASCII control characters and rejects dangerous schemes before application code receives an event: `about:`, `blob:`, `data:`, `file:`, `javascript:`, `vbscript:`, and `view-source:`. Custom app schemes and ordinary web URLs remain valid when they pass those checks.

Guardrail: no cold-start queue, warm-start handoff, protocol registration, OS file association, or host event injection is synthesized. `App.onOpenFile` and `App.onOpenUrl` remain TypeScript event streams without native delivery.

Architecture-debt sweep: no wrapper was removed. `AppEventRouter` owns real routing and buffering policy, so it is not shallow wrapper debt. No separate follow-up was opened because #1337 already owns the missing host-backed open-intent event source and should avoid adding a parallel OpenIntent DSL.

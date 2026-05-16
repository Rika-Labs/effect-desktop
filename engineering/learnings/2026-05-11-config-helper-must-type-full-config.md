# Config helper must type full config

## Context

`defineDesktopConfig` was constrained to `ProductionSecurityConfig`, so the documented app config shape failed at the first `app` property. The helper advertised for authoring a desktop config only knew about the production security subset.

## Change

The config package now exports a full `DesktopConfig` authoring type covering app metadata, runtime, renderer, native, windows, security, permissions, protocols, build, signing, update, telemetry, protocol limits, env, and workspace fields. `defineDesktopConfig` preserves literal input types while constraining them to `DesktopConfig`; `ProductionSecurityConfig` remains the focused subset for production security checks.

## Lesson

Authoring helpers should model the file users write, not the narrowest downstream consumer. A subset type at the public boundary turns an internal shortcut into user-facing type drift.

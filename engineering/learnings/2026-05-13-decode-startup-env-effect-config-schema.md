# Decode Startup Env With Effect Config Schema

Issue: #1277

## What changed

Runtime startup no longer accepts a raw env record, manually parses
`EFFECT_DESKTOP_STARTUP_WINDOWS`, or validates `WindowSpec` with local type guards. Startup now reads
env through Effect `Config`, decodes startup windows and `DesktopAppDescriptor` exports through
Effect `Schema`, and leaves the supervisor with only desktop runtime policy: dynamic import
restrictions, reserved window names, and host window creation.

`main.ts` also stopped owning a custom truthy-value set. Smoke mode now uses Effect's boolean config
syntax, and malformed smoke values fail as typed `StartupWindowConfigError` values instead of being
silently treated as false.

## What mattered

The non-obvious part was that Config lookup precedence and Schema decoding precedence are different
decisions. `EFFECT_DESKTOP_APP_MODULE` wins over `EFFECT_DESKTOP_STARTUP_WINDOWS`, so the ignored
startup-window env value must not be decoded just because it exists. Eagerly decoding every config
field would make a valid app module fail because of malformed fallback JSON.

The other sharp edge was `Config.option` / `Config.withDefault` around `Config.boolean`. In this
Effect version, they are useful for lookup defaults, but they can turn an invalid boolean value into
absence/default behavior. The runtime wanted malformed smoke mode to fail loudly, so the final shape
reads the raw optional string with `Config` and then runs `Config.Boolean` through Schema explicitly:

```ts
const decodeSmokeTest = (value: Option.Option<string>) =>
  Option.match(value, {
    onNone: () => Effect.succeed(false),
    onSome: (raw) => Schema.decodeUnknownEffect(Config.Boolean)(raw)
  })
```

## Review changes

Review changed two concrete behaviors:

- app-module startup now skips decoding `EFFECT_DESKTOP_STARTUP_WINDOWS`, preserving module
  precedence even when the ignored env JSON is malformed;
- runtime subprocess tests now clear `EFFECT_DESKTOP_APP_EXPORT`, so inherited shell env cannot
  make module export tests flaky.

## Architecture-debt sweep

Removed here: raw env object reader API, local `JSON.parse`, manual `WindowSpec` guards, local
truthy env parsing, and the assertion-style `isDesktopAppConfig` guard.

Kept intentionally: `toStartupModuleSpecifier`, because it owns dynamic import policy for desktop
runtime startup. No follow-up issue was opened; the thin layers in the touched area were small enough
to remove in this ticket.

## Rule

When a Config value is optional only because of source precedence, read the raw optional value first
and decode it only in the branch that will use it; otherwise ignored fallback config can fail the
active path.

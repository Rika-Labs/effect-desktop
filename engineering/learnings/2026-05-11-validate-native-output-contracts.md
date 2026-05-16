# Validate Native Output Contracts

## Planned

Reject malformed native host output before app-facing services expose it as successful data.

## Shipped

PowerMonitor event reasons are now absent-or-non-empty. WebView navigation-blocked event URLs now use the same absolute URL contract as navigation inputs. Canonical Path outputs now reject relative host paths. Rust Dock support checks now reject blank and unknown method names instead of reporting them as unsupported platform features.

## Lesson

`supported: false` and successful output values must describe real platform state, not malformed protocol input. Narrow output schemas keep host bugs from becoming app-visible facts.

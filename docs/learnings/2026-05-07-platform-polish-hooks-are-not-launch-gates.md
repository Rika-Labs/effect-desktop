# Platform Polish Hooks Are Not Launch Gates

## Observation

The first Windows polish implementation made two local shortcuts: it forced dark title-bar styling without reading the current appearance, and it treated every Windows API failure as fatal startup failure. Review exposed that platform polish must follow the actual platform source of truth and must not prevent a valid app window from launching when the optional polish attribute is unavailable.

## Evidence

- PR: https://github.com/Rika-Labs/effect-desktop/pull/312
- Issue: https://github.com/Rika-Labs/effect-desktop/issues/102
- Review findings:
  - Dark mode was hardcoded instead of following system appearance.
  - AppUserModelID skipped silently when the env override was absent.
  - `SetProcessDpiAwarenessContext` `ERROR_ACCESS_DENIED` can mean DPI awareness was already set.
  - Unsupported DWM dark-mode attributes should not fail window creation.
- Fix commits: `6328df9`, `f193462`.
- Verification:
  - `cargo test -p host` passed with 78 host tests plus startup smoke.
  - `cargo clippy -p host --all-targets -- -D warnings` passed locally.
  - `cargo check --workspace` passed locally.
  - Blacksmith CI passed on Ubuntu, Windows, and macOS.

## General principle

Platform polish should be owned by the platform module, but optional polish must degrade as an observable warning unless the missing behavior breaks a core invariant. Identity and appearance must come from durable app/platform state, not a convenient hardcoded value.

## Trigger condition

Apply this when adding OS integration for visual style, taskbar/dock grouping, DPI behavior, menu chrome, shortcuts, badges, or other platform-convention features.

## Limits / counterexamples

Security, signing, update integrity, permissions, and data-loss prevention are not polish. Those failures should remain typed hard failures when the invariant cannot be preserved.

## Codification target

- docs/learnings

## Proposed amendment or issue

No new issue. The host now reads AppUserModelID from the packaged app manifest when the env override is absent, derives dark-mode styling from Tao's current window theme, treats pre-set DPI awareness as non-fatal, and logs unsupported DWM dark-mode attributes without failing window creation.

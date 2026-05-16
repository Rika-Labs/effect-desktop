# macOS Manual Gates

Release-cycle sign-off file for matrix cells that cannot run on regular CI.

Tracked gates:

| Gate                                       | Cell                       | Status                   | Evidence                                                                                          |
| ------------------------------------------ | -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| `macos-x64` required cell                  | `macos-x64`                | pending release sign-off | A real macOS x64 runner or signed manual release evidence must be attached before v1.0.0 release. |
| `C.54` notarization staple expiry          | `macos-arm64`, `macos-x64` | pending release sign-off | Manual macOS release-gate evidence required.                                                      |
| `C.71` macOS hardened-runtime entitlements | `macos-arm64`, `macos-x64` | pending release sign-off | Manual macOS release-gate evidence required.                                                      |
| `C.81` open-at-login contract              | `macos-arm64`, `macos-x64` | pending release sign-off | Manual macOS release-gate evidence required where a logged-in session is needed.                  |

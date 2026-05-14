# Windows Manual Gates

Release-cycle sign-off file for matrix cells that cannot run on regular CI.

Tracked gates:

| Gate                                  | Cell          | Status                   | Evidence                                                                           |
| ------------------------------------- | ------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `C.72` Windows Authenticode timestamp | `windows-x64` | pending release sign-off | Manual Windows release-gate evidence required.                                     |
| `C.81` open-at-login contract         | `windows-x64` | pending release sign-off | Manual Windows release-gate evidence required where a logged-in session is needed. |

# Issue 769 Architecture Review

Locked architecture: keep sibling packages as `workspace:*` in the repo manifest, rewrite them only in an installable artifact, and add an external consumer smoke test.

Review findings:

| Check        | Verdict | Notes                                                                                                                       |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| Correctness  | Pass    | The artifact has no `workspace:*` dependency specs and installs from a temp app with no workspace context.                  |
| Minimality   | Pass    | The packer copies only `bridge`, `config`, and `cli`, then rewrites only the copied CLI manifest.                           |
| Safety       | Pass    | The checked-in workspace manifest remains frozen-lockfile stable; TypeScript is declared because the CLI imports it at run. |
| Verification | Pass    | The temp-app smoke exercises install plus `bunx desktop`, not only manifest text.                                           |

Rejected expansion: changing the source CLI manifest to relative `file:` dependencies. It makes `bun install --frozen-lockfile` fail under Bun 1.3.13 even after regenerating the lockfile, so it violates the repo validation gate.

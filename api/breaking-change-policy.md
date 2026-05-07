# Public API Breaking-Change Policy

Effect Desktop treats every package root export as public once v1.0.0 is released.

`bun desktop check --api` compares the current root export surface against
`api/snapshots/*.snapshot.json`. A change is release-blocking unless it is
intentional and reviewed with an updated snapshot.

Breaking changes include:

- removing an exported symbol;
- changing an exported symbol kind;
- changing an exported symbol signature.

New exports are also blocked by the freeze gate until the snapshot is updated,
so reviewers can approve the added stability promise explicitly.

Use `bun desktop check --api --write` only when the public API change is
intentional. The snapshot diff is the review artifact.

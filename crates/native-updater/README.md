# native-updater

Native update-manifest verification for Effect Desktop.

The crate owns the client-side trust decision for signed update manifests:

- parse the §23.4 manifest shape;
- compute the canonical JSON bytes with the top-level `signature` field removed;
- verify the Ed25519 manifest signature with `ed25519-dalek`;
- accept trust anchors only within `manifest.keyVersion - 2..=manifest.keyVersion`.

Dependencies are intentionally small:

- `ed25519-dalek` provides strict Ed25519 verification instead of hand-rolled signature math;
- `semver` compares manifest, installed, floor, and rollback-window versions according to release version semantics;
- `base64` decodes the `ed25519:<base64>` public key and signature envelope;
- `serde` and `serde_json` parse the manifest shape and canonical JSON values.

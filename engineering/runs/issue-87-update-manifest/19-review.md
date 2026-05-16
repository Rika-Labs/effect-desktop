# Issue 87 Review: Update Manifest Format and Signature Verification

## Artifact inventory

| Artifact               | Status | Evidence                                                                                                                                                         |
| ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub issue           | pass   | #87 defines schema, canonical encoding, Ed25519 signing, byte-stability, and key-window verification.                                                            |
| Spec grounding         | pass   | `engineering/SPEC.md` §23.4 defines the manifest shape, Ed25519 signature coverage, canonical byte-stability, and `keyVersion - 2` trust window.                 |
| Repository grounding   | pass   | `packages/cli` already owns build/package/sign/notarize release commands; `crates/native-updater` is still a Phase 0 stub and is the correct verification owner. |
| External API grounding | pass   | Node/Bun crypto supports one-shot Ed25519 signing with `algorithm = null`; `ed25519-dalek` exposes strict Ed25519 verification for Rust.                         |
| Architecture           | pass   | `05-architect.md` names one canonical-byte mechanism with TypeScript publishing and Rust verification.                                                           |

## Principle-compliance pass

| Principle                         | Status         | Evidence                                                                                                             | Fix               |
| --------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
| First-principles derivation       | pass           | The trust decision reduces to one signed canonical byte string.                                                      | None              |
| Game-theoretic incentive fit      | pass           | Publisher cannot ship a manifest unless re-serialization produces the same canonical bytes.                          | None              |
| Minimal code                      | pass           | No update service, channel router, installer, or HSM flow is added.                                                  | None              |
| Single source of truth            | pass-with-note | TypeScript and Rust both implement the same canonicalization contract; tests must use reordered JSON to catch drift. | Add parity tests. |
| Deep modules, narrow interfaces   | pass           | `runDesktopPublish` and `verify_manifest` are the only entry points.                                                 | None              |
| Functional core, imperative shell | pass           | Canonicalization and verification are pure; config/files/env are shell code.                                         | None              |
| State machines for lifecycle      | pass           | Publish and verify transitions are named in the architecture.                                                        | None              |
| Ports / adapters at I/O           | pass           | Files, env, crypto signing, and Rust verification are separate ports.                                                | None              |
| Typed errors                      | pass           | Design requires config/file/signature/verifier errors as values.                                                     | None              |
| Effect discipline                 | pass           | CLI effectful code stays in `Effect`; pure canonicalization remains plain TypeScript.                                | None              |
| No silent fallbacks               | pass           | Missing keys, missing artifacts, unstable encoding, and invalid signatures fail.                                     | None              |
| Security                          | pass           | Private key is env-only; reports contain public metadata and signatures only.                                        | None              |
| Testability                       | pass           | Required tests are explicit: happy path, reordered fields, tampered version, old key, and stability rejection.       | None              |

## Reality-check pass

- Future contributors may use `JSON.stringify` directly and accidentally sign insertion order. The canonicalization function must be exported and tests must assert reordered input has identical canonical bytes.
- The spec phrase "signed with `update.publicKey`" is imprecise: signing needs a private key, while verification uses the public key. This run should introduce an explicit `update.privateKeyEnv` publish-only input and keep `update.publicKey` as the trust anchor.
- Key rotation can be implemented incorrectly as "accept any provided key". The Rust verifier must filter anchors to `manifest.keyVersion`, `-1`, and `-2`.

## Required fixes before work

None.

## Permitted as-is

Artifact signatures are generated with the same Ed25519 release key and recorded per artifact. Actual install-time artifact download and rollback semantics remain out of scope for #88 and #89.

## Issue candidates captured

None.

## Verdict

locked

## Handoff

Design locked. Continue to `/work`.

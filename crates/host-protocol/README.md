# `crates/host-protocol`

`host-protocol` owns the Rust wire types for the host-runtime protocol.

## Purpose

- Define the canonical host protocol envelope from `docs/SPEC.md` §9.3.
- Define the closed Appendix L host-wire error tag/details shape.
- Provide shared JSON fixtures consumed by Rust serde tests and the TypeScript bridge Schema mirror.

## Dependency notes

- `serde` owns Rust encode/decode derives for the wire contract.
- `serde_json` owns JSON `payload`/fixture values at the envelope boundary.

Both dependencies are declared in the workspace root per `docs/SPEC.md` §5.6.

## Non-goals

- Transport framing.
- Host method dispatch.
- Version negotiation behavior.
- Error recoverability defaults and platform mapping depth, which are owned by issue #61.

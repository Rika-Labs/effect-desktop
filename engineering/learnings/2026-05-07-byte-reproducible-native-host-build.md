---
date: 2026-05-07
type: in-flight-decision
topic: Make native host build byte-reproducible for repro gate
issue: https://github.com/Rika-Labs/effect-desktop/issues/255
pr: https://github.com/Rika-Labs/effect-desktop/pull/736
---

# Make native host build byte-reproducible for repro gate

## What we set out to do

Issue #255 captured the follow-up from repro check work: the native host binary was not byte-identical between two `cargo build -p host` passes, blocking `desktop check --repro` from running against real packaged artifacts.

## Root causes found

1. `crates/host/build.rs` generated `include_bytes!("/absolute/path/to/asset")` with the absolute playground dist path. The absolute checkout directory string was embedded in the compiled binary.
2. `crates/host/src/main.rs` used `env!("CARGO_MANIFEST_DIR")` to compute the runtime CWD. This macro expands to an absolute path string literal at compile time, which is embedded in the binary.
3. Debug builds include non-deterministic Rust codegen-unit names (`host-xxx.rcgu.o`) in debug info, causing byte differences even from the same checkout directory.

## What actually ended up working

Three coordinated changes:

1. **build.rs**: Copy each playground dist asset into `OUT_DIR/assets/` maintaining relative structure, then emit `include_bytes!("assets/relative/path")`. Since the generated `embedded_assets.rs` lives inside `OUT_DIR`, the relative path resolves identically regardless of the absolute `OUT_DIR` value.
2. **main.rs**: Replace `env!("CARGO_MANIFEST_DIR")` with the literal relative path `../../packages/core`. Under `cargo run` the CWD is the crate manifest dir (`crates/host`), so the relative path resolves to the same workspace location.
3. **CLI**: Switch `cargo build -p host` to `cargo build -p host --release`. Verified experimentally that release builds produce identical SHA-256 hashes across clean rebuilds from the same directory. Debug builds differ due to randomized `.rcgu.o` names in debug info.

## Verification

- `cargo test --workspace` — all Rust tests pass (102 host unit + 1 integration).
- `bun test` — all 639 TypeScript tests pass.
- `cargo build -p host --release` twice with `cargo clean -p host` in between produces identical `sha256sum`.

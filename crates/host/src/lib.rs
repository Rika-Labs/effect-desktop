//! Phase 0 stub. The crate exists so the Cargo workspace resolves and `cargo
//! check --workspace` / `cargo test --workspace` have something to compile.
//! Real implementation lands in later phases per `docs/SPEC.md` §24.

#[cfg(test)]
mod tests {
    #[test]
    fn it_compiles() {
        assert_eq!(2 + 2, 4);
    }
}

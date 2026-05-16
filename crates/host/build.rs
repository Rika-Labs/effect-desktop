use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("host crate should live under crates/host");
    let csp_policy_path = repo_root
        .join("packages")
        .join("config")
        .join("src")
        .join("default-csp-policy.json");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let generated_csp = out_dir.join("generated_csp.rs");

    println!("cargo:rerun-if-changed={}", csp_policy_path.display());

    let csp_source = fs::read_to_string(csp_policy_path).expect("failed to read CSP policy");
    fs::write(generated_csp, generate_csp_source(&csp_source))
        .expect("failed to write generated CSP module");
}

fn debug_literal(value: &str) -> String {
    format!("{value:?}")
}

fn generate_csp_source(source: &str) -> String {
    let value: serde_json::Value = serde_json::from_str(source).expect("CSP policy must be JSON");
    let directives = value
        .get("directives")
        .and_then(serde_json::Value::as_array)
        .expect("CSP policy must contain directives");
    let mut output =
        String::from("pub(crate) const DEFAULT_CSP_DIRECTIVES: &[(&str, &[&str])] = &[\n");

    for directive in directives {
        let name = directive
            .get("name")
            .and_then(serde_json::Value::as_str)
            .expect("CSP directive must contain a name");
        let values = directive
            .get("values")
            .and_then(serde_json::Value::as_array)
            .expect("CSP directive must contain values");
        output.push_str("    (");
        output.push_str(&debug_literal(name));
        output.push_str(", &[");
        for value in values {
            let value = value
                .as_str()
                .expect("CSP directive values must be strings");
            output.push_str(&debug_literal(value));
            output.push_str(", ");
        }
        output.push_str("]),\n");
    }

    output.push_str("];\n");
    output
}

use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("host crate should live under crates/host");
    let dist_dir = repo_root.join("apps").join("playground").join("dist");
    let csp_policy_path = repo_root
        .join("packages")
        .join("config")
        .join("src")
        .join("default-csp-policy.json");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let generated = out_dir.join("embedded_assets.rs");
    let generated_csp = out_dir.join("generated_csp.rs");
    let assets_dir = out_dir.join("assets");

    println!("cargo:rerun-if-changed={}", dist_dir.display());
    println!("cargo:rerun-if-changed={}", csp_policy_path.display());

    let mut files = Vec::new();
    collect_files(&dist_dir, &dist_dir, &mut files).expect("failed to scan playground dist");
    files.sort_by(|left, right| left.0.cmp(&right.0));

    let mut source = String::from(
        "pub(crate) struct GeneratedAsset {\n    pub(crate) path: &'static str,\n    pub(crate) bytes: &'static [u8],\n}\n\npub(crate) const GENERATED_ASSETS: &[GeneratedAsset] = &[\n",
    );

    for (asset_path, file_path) in files {
        println!("cargo:rerun-if-changed={}", file_path.display());

        let relative = file_path
            .strip_prefix(&dist_dir)
            .expect("walked file should stay inside dist");
        let out_asset_path = assets_dir.join(relative);
        if let Some(parent) = out_asset_path.parent() {
            fs::create_dir_all(parent).expect("failed to create asset output directory");
        }
        fs::copy(&file_path, &out_asset_path).expect("failed to copy asset to output directory");

        let include_path = format!("assets/{}", relative.to_string_lossy().replace('\\', "/"));
        source.push_str("    GeneratedAsset {\n");
        source.push_str(&format!("        path: {},\n", debug_literal(&asset_path)));
        source.push_str(&format!(
            "        bytes: include_bytes!({}),\n",
            debug_literal(&include_path)
        ));
        source.push_str("    },\n");
    }

    source.push_str("];\n");
    fs::write(generated, source).expect("failed to write embedded asset module");

    let csp_source = fs::read_to_string(csp_policy_path).expect("failed to read CSP policy");
    fs::write(generated_csp, generate_csp_source(&csp_source))
        .expect("failed to write generated CSP module");
}

fn collect_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<(String, PathBuf)>,
) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, files)?;
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .expect("walked file should stay inside dist");
        let asset_path = format!("/{}", relative.to_string_lossy().replace('\\', "/"));
        files.push((asset_path, path));
    }

    Ok(())
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

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
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let generated = out_dir.join("embedded_assets.rs");

    println!("cargo:rerun-if-changed={}", dist_dir.display());

    let mut files = Vec::new();
    collect_files(&dist_dir, &dist_dir, &mut files).expect("failed to scan playground dist");
    files.sort_by(|left, right| left.0.cmp(&right.0));

    let mut source = String::from(
        "pub(crate) struct GeneratedAsset {\n    pub(crate) path: &'static str,\n    pub(crate) bytes: &'static [u8],\n}\n\npub(crate) const GENERATED_ASSETS: &[GeneratedAsset] = &[\n",
    );

    for (asset_path, file_path) in files {
        println!("cargo:rerun-if-changed={}", file_path.display());
        source.push_str("    GeneratedAsset {\n");
        source.push_str(&format!("        path: {},\n", debug_literal(&asset_path)));
        source.push_str(&format!(
            "        bytes: include_bytes!({}),\n",
            debug_literal(&file_path.display().to_string())
        ));
        source.push_str("    },\n");
    }

    source.push_str("];\n");
    fs::write(generated, source).expect("failed to write embedded asset module");
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

use std::{env, fs, path::Path};

use serde_json::Value;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be set");
    let bridge_package_json = Path::new(&manifest_dir).join("../../packages/bridge/package.json");
    let package_json = fs::read_to_string(&bridge_package_json)
        .expect("failed to read packages/bridge/package.json");
    let package: Value =
        serde_json::from_str(&package_json).expect("failed to parse packages/bridge/package.json");
    let version = package
        .get("version")
        .and_then(Value::as_str)
        .expect("packages/bridge/package.json must contain a string version");

    println!("cargo:rerun-if-changed={}", bridge_package_json.display());
    println!("cargo:rustc-env=EFFECT_DESKTOP_HOST_PROTOCOL_VERSION={version}");
}

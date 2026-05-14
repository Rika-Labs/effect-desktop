use crate::runtime;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Asset {
    pub(crate) bytes: Vec<u8>,
    pub(crate) content_type: &'static str,
}

const INDEX_PATH: &str = "/index.html";
const HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const CSS_CONTENT_TYPE: &str = "text/css; charset=utf-8";
const JAVASCRIPT_CONTENT_TYPE: &str = "text/javascript; charset=utf-8";
const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";
const SVG_CONTENT_TYPE: &str = "image/svg+xml";
const PNG_CONTENT_TYPE: &str = "image/png";
const JPEG_CONTENT_TYPE: &str = "image/jpeg";
const WEBP_CONTENT_TYPE: &str = "image/webp";
const ICO_CONTENT_TYPE: &str = "image/x-icon";
const WOFF2_CONTENT_TYPE: &str = "font/woff2";
const WOFF_CONTENT_TYPE: &str = "font/woff";
const TTF_CONTENT_TYPE: &str = "font/ttf";
const TEXT_PLAIN_CONTENT_TYPE: &str = "text/plain; charset=utf-8";
const XML_CONTENT_TYPE: &str = "application/xml; charset=utf-8";
const SOURCE_MAP_CONTENT_TYPE: &str = "application/json; charset=utf-8";
const OCTET_STREAM_CONTENT_TYPE: &str = "application/octet-stream";
const DEFAULT_SOURCE_RENDERER_DIST: &[&str] = &["apps", "inspector", "dist"];

pub(crate) fn resolve(path: &str) -> Option<Asset> {
    let normalized_path = normalize_path(path)?;
    let root = renderer_asset_root()?;
    resolve_from_root(&root, normalized_path)
}

fn resolve_from_root(root: &Path, normalized_path: &str) -> Option<Asset> {
    let normalized_path = normalize_path(normalized_path)?;
    let relative_path = normalized_path.strip_prefix('/')?;
    let file_path = root.join(relative_path);
    if !file_path.is_file() {
        return None;
    }

    Some(Asset {
        bytes: fs::read(file_path).ok()?,
        content_type: content_type_for_path(normalized_path),
    })
}

fn normalize_path(path: &str) -> Option<&str> {
    if path.is_empty() || path == "/" {
        return Some(INDEX_PATH);
    }

    if !path.starts_with('/') || path.contains('\\') || path.split('/').any(|part| part == "..") {
        return None;
    }

    Some(path)
}

fn renderer_asset_root() -> Option<PathBuf> {
    let current_exe = std::env::current_exe().ok()?;
    if let Some(manifest_path) = runtime::manifest_path_for_exe(&current_exe) {
        return renderer_asset_root_from_manifest_path(&manifest_path);
    }

    source_renderer_asset_root([
        std::env::current_dir().ok(),
        current_exe.parent().map(Path::to_path_buf),
    ])
}

fn renderer_asset_root_from_manifest_path(manifest_path: &Path) -> Option<PathBuf> {
    let layout_root = manifest_path.parent()?;
    let manifest = fs::read_to_string(manifest_path).ok()?;
    renderer_asset_root_from_manifest_str(&manifest, layout_root)
}

fn renderer_asset_root_from_manifest_str(source: &str, layout_root: &Path) -> Option<PathBuf> {
    let value: Value = serde_json::from_str(source).ok()?;
    let renderer_path = value
        .get("renderer")
        .and_then(|renderer| renderer.get("path"))
        .and_then(Value::as_str)?;
    if !is_contained_manifest_path(renderer_path) {
        return None;
    }

    Some(layout_root.join(renderer_path))
}

fn source_renderer_asset_root(
    anchors: impl IntoIterator<Item = Option<PathBuf>>,
) -> Option<PathBuf> {
    for anchor in anchors.into_iter().flatten() {
        for candidate in anchor.ancestors() {
            let root = DEFAULT_SOURCE_RENDERER_DIST
                .iter()
                .fold(candidate.to_path_buf(), |path, segment| path.join(segment));
            if root.is_dir() {
                return Some(root);
            }
        }
    }

    None
}

fn is_contained_manifest_path(value: &str) -> bool {
    !value.is_empty()
        && !Path::new(value).is_absolute()
        && !value.contains('\\')
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn content_type_for_path(path: &str) -> &'static str {
    if path.ends_with(".html") {
        HTML_CONTENT_TYPE
    } else if path.ends_with(".css") {
        CSS_CONTENT_TYPE
    } else if path.ends_with(".js") || path.ends_with(".mjs") {
        JAVASCRIPT_CONTENT_TYPE
    } else if path.ends_with(".map") {
        SOURCE_MAP_CONTENT_TYPE
    } else if path.ends_with(".json") {
        JSON_CONTENT_TYPE
    } else if path.ends_with(".svg") {
        SVG_CONTENT_TYPE
    } else if path.ends_with(".png") {
        PNG_CONTENT_TYPE
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        JPEG_CONTENT_TYPE
    } else if path.ends_with(".webp") {
        WEBP_CONTENT_TYPE
    } else if path.ends_with(".ico") {
        ICO_CONTENT_TYPE
    } else if path.ends_with(".woff2") {
        WOFF2_CONTENT_TYPE
    } else if path.ends_with(".woff") {
        WOFF_CONTENT_TYPE
    } else if path.ends_with(".ttf") {
        TTF_CONTENT_TYPE
    } else if path.ends_with(".txt") {
        TEXT_PLAIN_CONTENT_TYPE
    } else if path.ends_with(".xml") {
        XML_CONTENT_TYPE
    } else {
        OCTET_STREAM_CONTENT_TYPE
    }
}

#[cfg(test)]
mod tests {
    use super::{
        renderer_asset_root_from_manifest_str, resolve, resolve_from_root,
        source_renderer_asset_root, CSS_CONTENT_TYPE, HTML_CONTENT_TYPE, JAVASCRIPT_CONTENT_TYPE,
    };
    use std::{
        fs::{create_dir_all, remove_dir_all, write},
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn root_resolves_to_source_index_html() {
        let root = temp_root("effect-desktop-host-assets-root");
        let dist = root.join("dist");
        write_asset_fixture(&dist);
        let asset = resolve_from_root(&dist, "/").expect("root should resolve");

        assert_eq!(asset.content_type, HTML_CONTENT_TYPE);
        let lower = asset.bytes.to_ascii_lowercase();
        assert!(lower.starts_with(b"<!doctype html>"));
        assert!(
            lower
                .windows(b"<script".len())
                .any(|window| window == b"<script"),
            "source renderer index should carry at least one script element"
        );

        remove_dir_all(root).expect("temp root should remove");
    }

    #[test]
    fn index_resolves_to_source_index_html() {
        let root = temp_root("effect-desktop-host-assets-index");
        let dist = root.join("dist");
        write_asset_fixture(&dist);
        let root_asset = resolve_from_root(&dist, "/").expect("root should resolve");
        let index = resolve_from_root(&dist, "/index.html").expect("index should resolve");

        assert_eq!(root_asset, index);

        remove_dir_all(root).expect("temp root should remove");
    }

    #[test]
    fn sibling_assets_resolve_with_mime_types() {
        let root = temp_root("effect-desktop-host-assets-siblings");
        let dist = root.join("dist");
        write_asset_fixture(&dist);
        let index = resolve_from_root(&dist, "/").expect("root should resolve");
        let index_text = std::str::from_utf8(&index.bytes).expect("index should be utf8");

        let css_path = first_attribute_with_suffix(index_text, "href=\"", ".css")
            .expect("index should reference a stylesheet");
        let js_path = first_attribute_with_suffix(index_text, "src=\"", ".js")
            .expect("index should reference a script");

        let css =
            resolve_from_root(&dist, app_asset_path(css_path)).expect("style asset should resolve");
        let js =
            resolve_from_root(&dist, app_asset_path(js_path)).expect("script asset should resolve");

        assert_eq!(css.content_type, CSS_CONTENT_TYPE);
        assert!(!css.bytes.is_empty(), "css asset should have content");
        assert_eq!(js.content_type, JAVASCRIPT_CONTENT_TYPE);
        assert!(!js.bytes.is_empty(), "js asset should have content");

        remove_dir_all(root).expect("temp root should remove");
    }

    #[test]
    fn misses_do_not_fall_back() {
        assert_eq!(resolve("/missing.js"), None);
        assert_eq!(resolve("/nested/missing.css"), None);
    }

    #[test]
    fn traversal_shaped_paths_are_rejected() {
        assert_eq!(resolve("../index.html"), None);
        assert_eq!(resolve("/../index.html"), None);
        assert_eq!(resolve("/assets/../index.html"), None);
        assert_eq!(resolve("\\index.html"), None);
    }

    #[test]
    fn packaged_manifest_renderer_path_resolves_assets_from_layout() {
        let root = temp_root("effect-desktop-host-assets-packaged");
        let layout = root.join("layout");
        let renderer = layout.join("renderer").join("assets");
        create_dir_all(&renderer).expect("renderer directory should be created");
        write(
            layout.join("app-manifest.json"),
            r#"{"renderer":{"path":"renderer"}}"#,
        )
        .expect("manifest should write");
        write(
            layout.join("renderer").join("index.html"),
            "<!doctype html><h1>ok</h1>",
        )
        .expect("index should write");
        write(renderer.join("style.css"), "body{}").expect("css should write");

        let asset_root =
            renderer_asset_root_from_manifest_str(r#"{"renderer":{"path":"renderer"}}"#, &layout)
                .expect("renderer root should resolve");
        let index = resolve_from_root(&asset_root, "/").expect("index should resolve");
        let css = resolve_from_root(&asset_root, "/assets/style.css").expect("css should resolve");

        assert_eq!(index.bytes, b"<!doctype html><h1>ok</h1>");
        assert_eq!(index.content_type, HTML_CONTENT_TYPE);
        assert_eq!(css.bytes, b"body{}");
        assert_eq!(css.content_type, CSS_CONTENT_TYPE);

        remove_dir_all(root).expect("temp root should remove");
    }

    #[test]
    fn manifest_renderer_path_must_stay_inside_layout() {
        let layout = Path::new("/app/layout");

        assert_eq!(
            renderer_asset_root_from_manifest_str(r#"{"renderer":{"path":"../renderer"}}"#, layout),
            None
        );
        assert_eq!(
            renderer_asset_root_from_manifest_str(r#"{"renderer":{"path":"/renderer"}}"#, layout),
            None
        );
        assert_eq!(
            renderer_asset_root_from_manifest_str(
                r#"{"renderer":{"path":"renderer\\dist"}}"#,
                layout
            ),
            None
        );
    }

    #[test]
    fn source_renderer_root_uses_inspector_dist_without_embedding() {
        let root = temp_root("effect-desktop-host-assets-source");
        let dist = root.join("apps").join("inspector").join("dist");
        create_dir_all(&dist).expect("source dist should be created");

        assert_eq!(
            source_renderer_asset_root([Some(root.join("apps").join("inspector"))]),
            Some(dist)
        );

        remove_dir_all(root).expect("temp root should remove");
    }

    fn first_attribute_with_suffix<'a>(
        value: &'a str,
        attr: &str,
        suffix: &str,
    ) -> Option<&'a str> {
        let mut cursor = value;
        while let Some((_, after_start)) = cursor.split_once(attr) {
            let (inner, rest) = after_start.split_once('"')?;
            if inner.ends_with(suffix) {
                return Some(inner);
            }
            cursor = rest;
        }
        None
    }

    fn app_asset_path(value: &str) -> &str {
        value.strip_prefix("app://localhost").unwrap_or(value)
    }

    fn temp_root(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{nanos}"))
    }

    fn write_asset_fixture(root: &Path) {
        create_dir_all(root).expect("asset root should be created");
        write(
            root.join("index.html"),
            b"<!doctype html><html><head><link rel=\"stylesheet\" href=\"/style.css\"></head><body><script src=\"/app.js\"></script></body></html>",
        )
        .expect("index fixture should write");
        write(root.join("style.css"), b"body{}").expect("style fixture should write");
        write(root.join("app.js"), b"console.log('ok')").expect("script fixture should write");
    }
}

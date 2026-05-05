#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct EmbeddedAsset {
    pub(crate) bytes: &'static [u8],
    pub(crate) content_type: &'static str,
}

#[derive(Clone, Copy)]
struct AssetEntry {
    path: &'static str,
    bytes: &'static [u8],
}

const INDEX_PATH: &str = "/index.html";
const HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const CSS_CONTENT_TYPE: &str = "text/css; charset=utf-8";
const JAVASCRIPT_CONTENT_TYPE: &str = "text/javascript; charset=utf-8";
const OCTET_STREAM_CONTENT_TYPE: &str = "application/octet-stream";

const ASSETS: &[AssetEntry] = &[
    AssetEntry {
        path: INDEX_PATH,
        bytes: include_bytes!("../../../apps/playground/dist/index.html"),
    },
    AssetEntry {
        path: "/style.css",
        bytes: include_bytes!("../../../apps/playground/dist/style.css"),
    },
    AssetEntry {
        path: "/app.js",
        bytes: include_bytes!("../../../apps/playground/dist/app.js"),
    },
];

pub(crate) fn resolve(path: &str) -> Option<EmbeddedAsset> {
    let normalized_path = normalize_path(path)?;
    let entry = ASSETS.iter().find(|asset| asset.path == normalized_path)?;

    Some(EmbeddedAsset {
        bytes: entry.bytes,
        content_type: content_type_for_path(entry.path),
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

fn content_type_for_path(path: &str) -> &'static str {
    if path.ends_with(".html") {
        HTML_CONTENT_TYPE
    } else if path.ends_with(".css") {
        CSS_CONTENT_TYPE
    } else if path.ends_with(".js") {
        JAVASCRIPT_CONTENT_TYPE
    } else {
        OCTET_STREAM_CONTENT_TYPE
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve, CSS_CONTENT_TYPE, HTML_CONTENT_TYPE, JAVASCRIPT_CONTENT_TYPE};

    #[test]
    fn root_resolves_to_embedded_index_html() {
        let asset = resolve("/").expect("root should resolve");

        assert_eq!(asset.content_type, HTML_CONTENT_TYPE);
        assert!(asset.bytes.starts_with(b"<!doctype html>"));
        assert!(asset
            .bytes
            .windows(b"/style.css".len())
            .any(|window| window == b"/style.css"));
        assert!(asset
            .bytes
            .windows(b"/app.js".len())
            .any(|window| window == b"/app.js"));
    }

    #[test]
    fn index_resolves_to_embedded_index_html() {
        let root = resolve("/").expect("root should resolve");
        let index = resolve("/index.html").expect("index should resolve");

        assert_eq!(root, index);
    }

    #[test]
    fn sibling_assets_resolve_with_mime_types() {
        let css = resolve("/style.css").expect("style asset should resolve");
        let js = resolve("/app.js").expect("script asset should resolve");

        assert_eq!(css.content_type, CSS_CONTENT_TYPE);
        assert!(css
            .bytes
            .windows(b".shell".len())
            .any(|window| window == b".shell"));
        assert_eq!(js.content_type, JAVASCRIPT_CONTENT_TYPE);
        assert!(js
            .bytes
            .windows(b"Playground renderer hydrated".len())
            .any(|window| window == b"Playground renderer hydrated"));
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
}

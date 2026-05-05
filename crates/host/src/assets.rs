#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct EmbeddedAsset {
    pub(crate) bytes: &'static [u8],
    pub(crate) content_type: &'static str,
}

mod generated {
    include!(concat!(env!("OUT_DIR"), "/embedded_assets.rs"));
}

const INDEX_PATH: &str = "/index.html";
const HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const CSS_CONTENT_TYPE: &str = "text/css; charset=utf-8";
const JAVASCRIPT_CONTENT_TYPE: &str = "text/javascript; charset=utf-8";
const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";
const OCTET_STREAM_CONTENT_TYPE: &str = "application/octet-stream";

pub(crate) fn resolve(path: &str) -> Option<EmbeddedAsset> {
    let normalized_path = normalize_path(path)?;
    let entry = generated::GENERATED_ASSETS
        .iter()
        .find(|asset| asset.path == normalized_path)?;

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
    } else if path.ends_with(".json") {
        JSON_CONTENT_TYPE
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
            .windows(b"/assets/".len())
            .any(|window| window == b"/assets/"));
        assert!(asset
            .bytes
            .windows(b"__APP_NONCE__".len())
            .any(|window| window == b"__APP_NONCE__"));
    }

    #[test]
    fn index_resolves_to_embedded_index_html() {
        let root = resolve("/").expect("root should resolve");
        let index = resolve("/index.html").expect("index should resolve");

        assert_eq!(root, index);
    }

    #[test]
    fn sibling_assets_resolve_with_mime_types() {
        let index = resolve("/").expect("root should resolve");
        let index_text = std::str::from_utf8(index.bytes).expect("index should be utf8");
        let css_path = first_between(index_text, "href=\"", "\"")
            .expect("index should contain a stylesheet link");
        let js_path =
            first_between(index_text, "src=\"", "\"").expect("index should contain a script");
        let css = resolve(css_path).expect("style asset should resolve");
        let js = resolve(js_path).expect("script asset should resolve");

        assert_eq!(css.content_type, CSS_CONTENT_TYPE);
        assert!(css
            .bytes
            .windows(b"min-height".len())
            .any(|window| window == b"min-height"));
        assert_eq!(js.content_type, JAVASCRIPT_CONTENT_TYPE);
        assert!(js
            .bytes
            .windows(b"Effect Desktop playground renderer".len())
            .any(|window| window == b"Effect Desktop playground renderer"));
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

    fn first_between<'a>(value: &'a str, start: &str, end: &str) -> Option<&'a str> {
        let (_, after_start) = value.split_once(start)?;
        let (inner, _) = after_start.split_once(end)?;

        Some(inner)
    }
}

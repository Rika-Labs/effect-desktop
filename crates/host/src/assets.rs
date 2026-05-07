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
    use super::{resolve, CSS_CONTENT_TYPE, HTML_CONTENT_TYPE, JAVASCRIPT_CONTENT_TYPE};

    #[test]
    fn root_resolves_to_embedded_index_html() {
        let asset = resolve("/").expect("root should resolve");

        assert_eq!(asset.content_type, HTML_CONTENT_TYPE);
        let lower = asset.bytes.to_ascii_lowercase();
        assert!(lower.starts_with(b"<!doctype html>"));
        assert!(
            lower
                .windows(b"<script".len())
                .any(|window| window == b"<script"),
            "embedded index should carry at least one script element"
        );
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

        let css_path = first_attribute_with_suffix(index_text, "href=\"", ".css")
            .expect("index should reference a stylesheet");
        let js_path = first_attribute_with_suffix(index_text, "src=\"", ".js")
            .expect("index should reference a script");

        let css = resolve(app_asset_path(css_path)).expect("style asset should resolve");
        let js = resolve(app_asset_path(js_path)).expect("script asset should resolve");

        assert_eq!(css.content_type, CSS_CONTENT_TYPE);
        assert!(!css.bytes.is_empty(), "css asset should have content");
        assert_eq!(js.content_type, JAVASCRIPT_CONTENT_TYPE);
        assert!(!js.bytes.is_empty(), "js asset should have content");
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
}

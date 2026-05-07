use std::sync::atomic::{AtomicU32, Ordering};

use lol_html::errors::RewritingError;
use lol_html::{element, HtmlRewriter, Settings};

use crate::csp::CspNonce;

#[derive(Debug)]
pub(crate) struct RewriteOutcome {
    pub(crate) bytes: Vec<u8>,
    pub(crate) script_count: u32,
    pub(crate) style_count: u32,
    pub(crate) link_count: u32,
}

#[derive(Debug)]
pub(crate) enum RewriteError {
    Parse(RewritingError),
}

impl std::fmt::Display for RewriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RewriteError::Parse(error) => write!(f, "html rewrite failed: {error}"),
        }
    }
}

impl std::error::Error for RewriteError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            RewriteError::Parse(error) => Some(error),
        }
    }
}

pub(crate) fn rewrite_with_nonce(
    html: &[u8],
    nonce: &CspNonce,
) -> Result<RewriteOutcome, RewriteError> {
    let nonce_value = nonce.as_str().to_owned();
    let scripts = AtomicU32::new(0);
    let styles = AtomicU32::new(0);
    let links = AtomicU32::new(0);

    let mut output: Vec<u8> = Vec::with_capacity(html.len());

    {
        let mut rewriter = HtmlRewriter::new(
            Settings {
                element_content_handlers: vec![
                    element!("script", |el| {
                        el.set_attribute("nonce", &nonce_value)?;
                        scripts.fetch_add(1, Ordering::Relaxed);
                        Ok(())
                    }),
                    element!("style", |el| {
                        el.set_attribute("nonce", &nonce_value)?;
                        styles.fetch_add(1, Ordering::Relaxed);
                        Ok(())
                    }),
                    element!("link[rel=stylesheet]", |el| {
                        el.set_attribute("nonce", &nonce_value)?;
                        links.fetch_add(1, Ordering::Relaxed);
                        Ok(())
                    }),
                ],
                ..Settings::new()
            },
            |chunk: &[u8]| output.extend_from_slice(chunk),
        );

        rewriter.write(html).map_err(RewriteError::Parse)?;
        rewriter.end().map_err(RewriteError::Parse)?;
    }

    Ok(RewriteOutcome {
        bytes: output,
        script_count: scripts.load(Ordering::Relaxed),
        style_count: styles.load(Ordering::Relaxed),
        link_count: links.load(Ordering::Relaxed),
    })
}

#[cfg(test)]
mod tests {
    use super::{rewrite_with_nonce, RewriteError};
    use crate::csp::CspNonce;
    use lol_html::errors::RewritingError;

    fn nonce() -> CspNonce {
        CspNonce::fixed("nonce-x")
    }

    #[test]
    fn document_without_targets_passes_through_byte_for_byte() {
        let input =
            b"<!doctype html><html><head><title>x</title></head><body><p>hi</p></body></html>";
        let outcome = rewrite_with_nonce(input, &nonce()).expect("rewrite should succeed");

        assert_eq!(outcome.bytes, input);
        assert_eq!(outcome.script_count, 0);
        assert_eq!(outcome.style_count, 0);
        assert_eq!(outcome.link_count, 0);
    }

    #[test]
    fn inline_script_receives_nonce() {
        let input = b"<script>alert(1)</script>";
        let outcome = rewrite_with_nonce(input, &nonce()).expect("rewrite should succeed");

        assert_eq!(
            outcome.bytes,
            br#"<script nonce="nonce-x">alert(1)</script>"#
        );
        assert_eq!(outcome.script_count, 1);
    }

    #[test]
    fn external_script_keeps_src_and_receives_nonce() {
        let input = br#"<script src="/_next/static/chunks/x.js" async></script>"#;
        let outcome = rewrite_with_nonce(input, &nonce()).expect("rewrite should succeed");

        let body = std::str::from_utf8(&outcome.bytes).expect("utf-8");
        assert!(body.contains(r#"src="/_next/static/chunks/x.js""#));
        assert!(body.contains(r#"async"#));
        assert!(body.contains(r#"nonce="nonce-x""#));
        assert_eq!(outcome.script_count, 1);
    }

    #[test]
    fn inline_style_block_receives_nonce() {
        let input = b"<style>body{margin:0}</style>";
        let outcome = rewrite_with_nonce(input, &nonce()).expect("rewrite should succeed");

        assert_eq!(
            outcome.bytes,
            br#"<style nonce="nonce-x">body{margin:0}</style>"#
        );
        assert_eq!(outcome.style_count, 1);
    }

    #[test]
    fn stylesheet_link_receives_nonce() {
        let input = br#"<link rel="stylesheet" href="/_next/static/x.css">"#;
        let outcome = rewrite_with_nonce(input, &nonce()).expect("rewrite should succeed");

        let body = std::str::from_utf8(&outcome.bytes).expect("utf-8");
        assert!(body.contains(r#"href="/_next/static/x.css""#));
        assert!(body.contains(r#"nonce="nonce-x""#));
        assert_eq!(outcome.link_count, 1);
    }

    #[test]
    fn preload_links_are_not_modified() {
        let input = br#"<link rel="modulepreload" href="/_next/static/a.js"><link rel="preload" as="script" href="/_next/static/b.js"><link rel="icon" href="/favicon.ico">"#;
        let outcome = rewrite_with_nonce(input, &nonce()).expect("rewrite should succeed");

        let body = std::str::from_utf8(&outcome.bytes).expect("utf-8");
        assert!(!body.contains(r#"nonce="nonce-x""#));
        assert_eq!(outcome.link_count, 0);
    }

    #[test]
    fn prior_nonce_attribute_is_replaced_not_duplicated() {
        let input = br#"<script nonce="stale">x</script>"#;
        let first = rewrite_with_nonce(input, &nonce()).expect("rewrite should succeed");

        assert_eq!(first.bytes, br#"<script nonce="nonce-x">x</script>"#);

        let second = rewrite_with_nonce(&first.bytes, &nonce()).expect("rewrite should succeed");
        assert_eq!(second.bytes, first.bytes);
        assert_eq!(second.script_count, 1);
    }

    #[test]
    fn multi_match_document_counts_each_element() {
        let input = br#"<!doctype html><html><head><link rel="stylesheet" href="/a.css"><style>x</style><script src="/a.js"></script></head><body><script>y</script></body></html>"#;
        let outcome = rewrite_with_nonce(input, &nonce()).expect("rewrite should succeed");

        assert_eq!(outcome.script_count, 2);
        assert_eq!(outcome.style_count, 1);
        assert_eq!(outcome.link_count, 1);
        let body = std::str::from_utf8(&outcome.bytes).expect("utf-8");
        assert_eq!(body.matches(r#"nonce="nonce-x""#).count(), 4);
    }

    #[test]
    fn rewrite_error_implements_std_error() {
        let invalid_inner = RewritingError::ContentHandlerError(Box::<
            dyn std::error::Error + Send + Sync,
        >::from("boom"));
        let error = RewriteError::Parse(invalid_inner);
        let display = format!("{error}");
        assert!(display.starts_with("html rewrite failed"));
        let _: &dyn std::error::Error = &error;
    }
}

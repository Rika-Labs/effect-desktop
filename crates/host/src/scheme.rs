use std::borrow::Cow;

use wry::{
    http::{
        header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE},
        HeaderValue, Request, Response,
    },
    WebViewBuilder,
};

pub(crate) const APP_URL: &str = "app://localhost/";
pub(crate) const APP_PROTOCOL_SOURCE_KIND: &str = "app-protocol";

const APP_SCHEME: &str = "app";
const APP_HTML: &str = r#"<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Effect Desktop</title>
  </head>
  <body>
    <h1>app:// hello</h1>
    <p>app://localhost/ is served by the host protocol handler.</p>
  </body>
</html>"#;
const APP_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const APP_CSP: &str = "default-src 'self'; script-src 'none'; style-src 'none'; connect-src 'none'; img-src 'self' app: data:; font-src 'self' app: data:; media-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; manifest-src 'none'";

pub(crate) fn register_app_scheme<'a>(builder: WebViewBuilder<'a>) -> WebViewBuilder<'a> {
    builder.with_custom_protocol(APP_SCHEME.into(), |_webview_id, request| {
        app_scheme_response(&request)
    })
}

fn app_scheme_response(_request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let mut response = Response::new(Cow::Borrowed(APP_HTML.as_bytes()));
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(APP_CONTENT_TYPE));
    response
        .headers_mut()
        .insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(APP_CSP));
    response
}

#[cfg(test)]
mod tests {
    use super::{
        app_scheme_response, APP_CONTENT_TYPE, APP_CSP, APP_HTML, APP_PROTOCOL_SOURCE_KIND, APP_URL,
    };
    use wry::http::{
        header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE},
        HeaderValue, Request, StatusCode,
    };

    #[test]
    fn app_url_is_the_canonical_phase_one_renderer_url() {
        assert_eq!(APP_URL, "app://localhost/");
        assert_eq!(APP_PROTOCOL_SOURCE_KIND, "app-protocol");
    }

    #[test]
    fn app_scheme_response_returns_hard_coded_html() {
        let request = Request::builder()
            .uri(APP_URL)
            .body(Vec::new())
            .expect("test request should build");
        let response = app_scheme_response(&request);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static(APP_CONTENT_TYPE))
        );
        assert_eq!(
            response.headers().get(CONTENT_SECURITY_POLICY),
            Some(&HeaderValue::from_static(APP_CSP))
        );
        assert_eq!(response.body().as_ref(), APP_HTML.as_bytes());
    }

    #[test]
    fn app_html_does_not_reference_future_asset_or_remote_sources() {
        assert!(APP_HTML.contains("app://localhost/"));
        assert!(!APP_HTML.contains("file://"));
        assert!(!APP_HTML.contains("http://"));
        assert!(!APP_HTML.contains("https://"));
    }
}

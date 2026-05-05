use crate::assets;
use std::borrow::Cow;

use wry::{
    http::{
        header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE},
        HeaderValue, Request, Response, StatusCode,
    },
    WebViewBuilder,
};

pub(crate) const APP_URL: &str = "app://localhost/";
pub(crate) const APP_PROTOCOL_SOURCE_KIND: &str = "app-protocol";

const APP_SCHEME: &str = "app";
const APP_CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' app:; img-src 'self' app: data: https:; font-src 'self' app: data:; media-src 'self' app:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'";
const NOT_FOUND_BODY: &str = "app asset not found";
const TEXT_CONTENT_TYPE: &str = "text/plain; charset=utf-8";

pub(crate) fn register_app_scheme<'a>(builder: WebViewBuilder<'a>) -> WebViewBuilder<'a> {
    builder.with_custom_protocol(APP_SCHEME.into(), |_webview_id, request| {
        app_scheme_response(&request)
    })
}

fn app_scheme_response(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    match assets::resolve(request.uri().path()) {
        Some(asset) => app_response(
            StatusCode::OK,
            asset.content_type,
            Cow::Borrowed(asset.bytes),
        ),
        None => app_response(
            StatusCode::NOT_FOUND,
            TEXT_CONTENT_TYPE,
            Cow::Borrowed(NOT_FOUND_BODY.as_bytes()),
        ),
    }
}

fn app_response(
    status: StatusCode,
    content_type: &'static str,
    body: Cow<'static, [u8]>,
) -> Response<Cow<'static, [u8]>> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
        .headers_mut()
        .insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(APP_CSP));
    response
}

#[cfg(test)]
mod tests {
    use super::{
        app_scheme_response, APP_CSP, APP_PROTOCOL_SOURCE_KIND, APP_URL, TEXT_CONTENT_TYPE,
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
    fn app_scheme_response_returns_embedded_index_html() {
        let request = Request::builder()
            .uri(APP_URL)
            .body(Vec::new())
            .expect("test request should build");
        let response = app_scheme_response(&request);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static("text/html; charset=utf-8"))
        );
        assert_eq!(
            response.headers().get(CONTENT_SECURITY_POLICY),
            Some(&HeaderValue::from_static(APP_CSP))
        );
        assert!(response
            .body()
            .windows(b"Effect Desktop playground renderer".len())
            .any(|window| window == b"Effect Desktop playground renderer"));
    }

    #[test]
    fn app_scheme_response_returns_not_found_for_missing_assets() {
        let request = Request::builder()
            .uri("app://localhost/missing.js")
            .body(Vec::new())
            .expect("test request should build");
        let response = app_scheme_response(&request);

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static(TEXT_CONTENT_TYPE))
        );
        assert_eq!(
            response.headers().get(CONTENT_SECURITY_POLICY),
            Some(&HeaderValue::from_static(APP_CSP))
        );
        assert_eq!(response.body().as_ref(), b"app asset not found");
    }
}

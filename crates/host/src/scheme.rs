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
const APP_HOST: &str = "localhost";
const APP_NONCE_PLACEHOLDER: &str = "__APP_NONCE__";
const APP_CSP_TEMPLATE: &str = "default-src 'self'; script-src 'self' 'nonce-{N}'; style-src 'self' 'nonce-{N}'; connect-src 'self' app:; img-src 'self' app: data: https:; font-src 'self' app: data:; media-src 'self' app:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'";
const NOT_FOUND_BODY: &str = "app asset not found";
const TEXT_CONTENT_TYPE: &str = "text/plain; charset=utf-8";

pub(crate) fn register_app_scheme<'a>(builder: WebViewBuilder<'a>) -> WebViewBuilder<'a> {
    builder.with_custom_protocol(APP_SCHEME.into(), |_webview_id, request| {
        app_scheme_response(&request)
    })
}

fn app_scheme_response(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let nonce = CspNonce::mint();

    if request.uri().host() != Some(APP_HOST) {
        return app_not_found_response(&nonce);
    }

    match assets::resolve(request.uri().path()) {
        Some(asset) => app_response(
            StatusCode::OK,
            asset.content_type,
            csp_body(asset.content_type, asset.bytes, &nonce),
            &nonce,
        ),
        None => app_not_found_response(&nonce),
    }
}

fn app_not_found_response(nonce: &CspNonce) -> Response<Cow<'static, [u8]>> {
    app_response(
        StatusCode::NOT_FOUND,
        TEXT_CONTENT_TYPE,
        Cow::Borrowed(NOT_FOUND_BODY.as_bytes()),
        nonce,
    )
}

fn app_response(
    status: StatusCode,
    content_type: &'static str,
    body: Cow<'static, [u8]>,
    nonce: &CspNonce,
) -> Response<Cow<'static, [u8]>> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_str(&nonce.policy()).expect("generated CSP should be a valid header"),
    );
    response
}

fn csp_body(
    content_type: &'static str,
    body: &'static [u8],
    nonce: &CspNonce,
) -> Cow<'static, [u8]> {
    if !content_type.starts_with("text/html") {
        return Cow::Borrowed(body);
    }

    let Ok(html) = std::str::from_utf8(body) else {
        return Cow::Borrowed(body);
    };

    Cow::Owned(
        html.replace(APP_NONCE_PLACEHOLDER, nonce.as_str())
            .into_bytes(),
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CspNonce(String);

impl CspNonce {
    fn mint() -> Self {
        Self(uuid::Uuid::new_v4().simple().to_string())
    }

    #[cfg(test)]
    fn fixed(value: &str) -> Self {
        Self(value.to_owned())
    }

    fn as_str(&self) -> &str {
        &self.0
    }

    fn policy(&self) -> String {
        APP_CSP_TEMPLATE.replace("{N}", self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        app_scheme_response, csp_body, CspNonce, APP_CSP_TEMPLATE, APP_NONCE_PLACEHOLDER,
        APP_PROTOCOL_SOURCE_KIND, APP_URL, TEXT_CONTENT_TYPE,
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
            Some(
                &HeaderValue::from_str(&expected_csp(response.body()))
                    .expect("expected CSP should be a valid header")
            )
        );
        assert!(response
            .body()
            .windows(b"id=\"root\"".len())
            .any(|window| window == b"id=\"root\""));
        assert!(response
            .body()
            .windows(b"/assets/".len())
            .any(|window| window == b"/assets/"));
        assert!(response
            .body()
            .windows(APP_NONCE_PLACEHOLDER.len())
            .all(|window| window != APP_NONCE_PLACEHOLDER.as_bytes()));
        assert!(
            expected_csp(response.body()).contains("script-src 'self' 'nonce-"),
            "CSP should include a script nonce"
        );
        assert!(
            expected_csp(response.body()).contains("style-src 'self' 'nonce-"),
            "CSP should include a style nonce"
        );
        assert!(
            !expected_csp(response.body()).contains("unsafe-inline"),
            "production CSP should not allow unsafe inline execution"
        );
        assert!(
            !expected_csp(response.body()).contains("unsafe-eval"),
            "production CSP should not allow eval"
        );
    }

    #[test]
    fn app_scheme_response_mints_a_fresh_nonce_per_response() {
        let request = Request::builder()
            .uri(APP_URL)
            .body(Vec::new())
            .expect("test request should build");
        let first = app_scheme_response(&request);
        let second = app_scheme_response(&request);

        assert_ne!(
            first.headers().get(CONTENT_SECURITY_POLICY),
            second.headers().get(CONTENT_SECURITY_POLICY)
        );
        assert_ne!(first.body(), second.body());
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
            Some(
                &HeaderValue::from_str(
                    &APP_CSP_TEMPLATE.replace("{N}", csp_nonce_from_header(&response).as_str())
                )
                .expect("expected CSP should be a valid header")
            )
        );
        assert_eq!(response.body().as_ref(), b"app asset not found");
    }

    #[test]
    fn app_scheme_response_returns_not_found_for_non_canonical_hosts() {
        let request = Request::builder()
            .uri("app://other-host/index.html")
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
            Some(
                &HeaderValue::from_str(
                    &APP_CSP_TEMPLATE.replace("{N}", csp_nonce_from_header(&response).as_str())
                )
                .expect("expected CSP should be a valid header")
            )
        );
        assert_eq!(response.body().as_ref(), b"app asset not found");
    }

    #[test]
    fn csp_body_substitutes_html_only() {
        let nonce = CspNonce::fixed("fixednonce");
        let html = csp_body(
            "text/html; charset=utf-8",
            br#"<script nonce="__APP_NONCE__"></script>"#,
            &nonce,
        );
        let javascript = csp_body(
            "text/javascript; charset=utf-8",
            br#"console.log("__APP_NONCE__")"#,
            &nonce,
        );

        assert_eq!(
            html.as_ref(),
            br#"<script nonce="fixednonce"></script>"#.as_slice()
        );
        assert_eq!(
            javascript.as_ref(),
            br#"console.log("__APP_NONCE__")"#.as_slice()
        );
    }

    fn expected_csp(body: &[u8]) -> String {
        APP_CSP_TEMPLATE.replace("{N}", html_nonce(body))
    }

    fn html_nonce(body: &[u8]) -> &str {
        let text = std::str::from_utf8(body).expect("index should be valid utf8");
        let (_, after_start) = text
            .split_once("nonce=\"")
            .expect("index should include a nonce");
        let (nonce, _) = after_start
            .split_once('"')
            .expect("nonce attribute should be quoted");

        nonce
    }

    fn csp_nonce_from_header(
        response: &wry::http::Response<std::borrow::Cow<'static, [u8]>>,
    ) -> String {
        let csp = response
            .headers()
            .get(CONTENT_SECURITY_POLICY)
            .expect("response should include CSP")
            .to_str()
            .expect("CSP should be utf8");
        let (_, after_start) = csp
            .split_once("'nonce-")
            .expect("CSP should include a nonce");
        let (nonce, _) = after_start
            .split_once('\'')
            .expect("nonce directive should be quoted");

        nonce.to_owned()
    }
}

use crate::{assets, csp, html_csp};
use std::borrow::Cow;
use tracing::{debug, error, warn};

use wry::{
    http::{
        header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE},
        HeaderName, HeaderValue, Request, Response, StatusCode,
    },
    WebViewBuilder,
};

pub(crate) const APP_URL: &str = "app://localhost/";
pub(crate) const APP_PROTOCOL_SOURCE_KIND: &str = "app-protocol";

const APP_SCHEME: &str = "app";
const APP_HOST: &str = "localhost";
const NOT_FOUND_BODY: &str = "app asset not found";
const REWRITE_FAILED_BODY_PREFIX: &str = "app html rewrite failed; trace=";
const TEXT_CONTENT_TYPE: &str = "text/plain; charset=utf-8";
const TRACE_ID_HEADER: HeaderName = HeaderName::from_static("x-effect-trace-id");

type Rewriter =
    fn(&[u8], &csp::CspNonce) -> Result<html_csp::RewriteOutcome, html_csp::RewriteError>;

pub(crate) fn register_app_scheme<'a>(builder: WebViewBuilder<'a>) -> WebViewBuilder<'a> {
    builder.with_custom_protocol(APP_SCHEME.into(), |_webview_id, request| {
        app_scheme_response_with(&request, html_csp::rewrite_with_nonce)
    })
}

#[cfg(test)]
fn app_scheme_response(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    app_scheme_response_with(request, html_csp::rewrite_with_nonce)
}

fn app_scheme_response_with(
    request: &Request<Vec<u8>>,
    rewriter: Rewriter,
) -> Response<Cow<'static, [u8]>> {
    let nonce = csp::CspNonce::mint();
    let trace_id = request_trace_id(request);
    let path = request.uri().path().to_owned();

    if request.uri().host() != Some(APP_HOST) {
        return app_not_found_response(&nonce, &trace_id);
    }

    let Some(asset) = assets::resolve(&path) else {
        return app_not_found_response(&nonce, &trace_id);
    };

    if !asset.content_type.starts_with("text/html") {
        return app_response(
            StatusCode::OK,
            asset.content_type,
            Cow::Borrowed(asset.bytes),
            &nonce,
            &trace_id,
        );
    }

    match rewriter(asset.bytes, &nonce) {
        Ok(outcome) => {
            if outcome.script_count == 0 && outcome.style_count == 0 && outcome.link_count == 0 {
                warn!(
                    target: "host.csp",
                    path = %path,
                    "html response carries no script, style, or stylesheet link element"
                );
            } else {
                debug!(
                    target: "host.csp",
                    path = %path,
                    script = outcome.script_count,
                    style = outcome.style_count,
                    link = outcome.link_count,
                    "applied csp nonce to html response"
                );
            }

            app_response(
                StatusCode::OK,
                asset.content_type,
                Cow::Owned(outcome.bytes),
                &nonce,
                &trace_id,
            )
        }
        Err(rewrite_error) => {
            error!(
                target: "host.csp",
                path = %path,
                trace_id = ?trace_id,
                error = %rewrite_error,
                "html rewrite failed"
            );
            app_rewrite_error_response(&trace_id, &nonce)
        }
    }
}

fn app_not_found_response(
    nonce: &csp::CspNonce,
    trace_id: &HeaderValue,
) -> Response<Cow<'static, [u8]>> {
    app_response(
        StatusCode::NOT_FOUND,
        TEXT_CONTENT_TYPE,
        Cow::Borrowed(NOT_FOUND_BODY.as_bytes()),
        nonce,
        trace_id,
    )
}

fn app_rewrite_error_response(
    trace_id: &HeaderValue,
    nonce: &csp::CspNonce,
) -> Response<Cow<'static, [u8]>> {
    let trace_str = trace_id.to_str().unwrap_or("unknown");
    let body = format!("{REWRITE_FAILED_BODY_PREFIX}{trace_str}").into_bytes();
    app_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        TEXT_CONTENT_TYPE,
        Cow::Owned(body),
        nonce,
        trace_id,
    )
}

fn app_response(
    status: StatusCode,
    content_type: &'static str,
    body: Cow<'static, [u8]>,
    nonce: &csp::CspNonce,
    trace_id: &HeaderValue,
) -> Response<Cow<'static, [u8]>> {
    let policy = csp::CspPolicy::default_for_nonce(nonce);
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_str(policy.as_str()).expect("generated CSP should be a valid header"),
    );
    response
        .headers_mut()
        .insert(TRACE_ID_HEADER, trace_id.clone());
    response
}

fn request_trace_id(request: &Request<Vec<u8>>) -> HeaderValue {
    request
        .headers()
        .get(&TRACE_ID_HEADER)
        .cloned()
        .unwrap_or_else(|| {
            HeaderValue::from_str(format!("trace-{}", uuid::Uuid::now_v7()).as_str())
                .expect("generated trace id should be a valid header")
        })
}

#[cfg(test)]
mod tests {
    use super::{
        app_scheme_response, app_scheme_response_with, APP_PROTOCOL_SOURCE_KIND, APP_URL,
        REWRITE_FAILED_BODY_PREFIX, TEXT_CONTENT_TYPE, TRACE_ID_HEADER,
    };
    use crate::csp::{CspNonce, CspPolicy};
    use crate::html_csp::{RewriteError, RewriteOutcome};
    use lol_html::errors::RewritingError;
    use std::collections::BTreeSet;
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
            .header(TRACE_ID_HEADER, "trace-app-request")
            .body(Vec::new())
            .expect("test request should build");
        let response = app_scheme_response(&request);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static("text/html; charset=utf-8"))
        );
        assert_eq!(
            response.headers().get(TRACE_ID_HEADER),
            Some(&HeaderValue::from_static("trace-app-request"))
        );

        let header_nonce = csp_nonce_from_header(&response);
        assert_eq!(
            response.headers().get(CONTENT_SECURITY_POLICY),
            Some(
                &HeaderValue::from_str(
                    CspPolicy::default_for_nonce(&CspNonce::fixed(&header_nonce)).as_str()
                )
                .expect("expected CSP should be a valid header")
            )
        );

        let lower = response.body().to_ascii_lowercase();
        assert!(
            lower.starts_with(b"<!doctype html>"),
            "renderer index should start with the html5 doctype"
        );

        let body_str = std::str::from_utf8(response.body()).expect("body should be utf-8");
        assert!(
            !body_str.contains("__APP_NONCE__"),
            "rewritten body must not contain the legacy placeholder"
        );

        let nonces = collect_nonce_attribute_values(body_str);
        assert!(
            !nonces.is_empty(),
            "rewritten index should carry at least one nonce attribute"
        );
        assert_eq!(
            nonces,
            BTreeSet::from([header_nonce.clone()]),
            "every nonce attribute in the body should equal the CSP header nonce"
        );

        let policy = expected_csp(&header_nonce);
        assert!(policy.contains("script-src 'self' 'nonce-"));
        assert!(policy.contains("style-src 'self' 'nonce-"));
        assert!(!policy.contains("script-src 'self' 'unsafe-inline'"));
        assert!(!policy.contains("style-src 'self' 'unsafe-inline'"));
        assert!(!policy.contains("unsafe-eval"));
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
        assert_ne!(
            csp_nonce_from_header(&first),
            csp_nonce_from_header(&second)
        );
    }

    #[test]
    fn app_scheme_response_mints_trace_id_when_request_header_is_missing() {
        let request = Request::builder()
            .uri(APP_URL)
            .body(Vec::new())
            .expect("test request should build");
        let response = app_scheme_response(&request);

        let trace_id = response
            .headers()
            .get(TRACE_ID_HEADER)
            .expect("trace id header should be present")
            .to_str()
            .expect("trace id should be ASCII");
        assert!(trace_id.starts_with("trace-"));
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
        assert_eq!(response.body().as_ref(), b"app asset not found");
    }

    #[test]
    fn html_rewrite_failure_returns_500_with_trace_id_and_no_un_rewritten_body() {
        let request = Request::builder()
            .uri(APP_URL)
            .header(TRACE_ID_HEADER, "trace-rewrite-fails")
            .body(Vec::new())
            .expect("test request should build");

        let response = app_scheme_response_with(&request, faulty_rewriter);

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static(TEXT_CONTENT_TYPE))
        );
        assert_eq!(
            response.headers().get(TRACE_ID_HEADER),
            Some(&HeaderValue::from_static("trace-rewrite-fails"))
        );

        let body = std::str::from_utf8(response.body()).expect("error body should be utf-8");
        assert!(body.starts_with(REWRITE_FAILED_BODY_PREFIX));
        assert!(body.contains("trace-rewrite-fails"));
        assert!(
            !body.contains("<script") && !body.contains("<!doctype"),
            "error response must not include any embedded html bytes"
        );
    }

    fn faulty_rewriter(_: &[u8], _: &CspNonce) -> Result<RewriteOutcome, RewriteError> {
        Err(RewriteError::Parse(RewritingError::ContentHandlerError(
            Box::<dyn std::error::Error + Send + Sync>::from("synthetic-rewrite-failure"),
        )))
    }

    fn expected_csp(nonce: &str) -> String {
        CspPolicy::default_for_nonce(&CspNonce::fixed(nonce))
            .as_str()
            .to_owned()
    }

    fn collect_nonce_attribute_values(body: &str) -> BTreeSet<String> {
        let mut values = BTreeSet::new();
        let mut cursor = body;
        while let Some((_, after)) = cursor.split_once("nonce=\"") {
            let (value, rest) = after
                .split_once('"')
                .expect("nonce attribute should be quoted");
            values.insert(value.to_owned());
            cursor = rest;
        }
        values
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

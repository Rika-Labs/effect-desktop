use crate::{runtime, scheme};
use anyhow::Context;
use host_protocol::HostProtocolError;
use std::borrow::Cow;
use std::path::Path;
use tao::window::Window;
use tracing::info;
use wry::{WebView, WebViewBuilder};

const WEBVIEW_OPENED_EVENT: &str = "host.webview.opened";
const DEV_URL_ENV: &str = "EFFECT_DESKTOP_DEV_URL";
const WEBVIEW_CREATE_OPERATION: &str = host_protocol::WINDOW_CREATE_METHOD;

pub(crate) type HostWebView = WebView;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WebEngineKind {
    System,
    Chromium,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewCapabilities {
    engine: WebEngineKind,
    available: bool,
}

trait WebEngineProvider {
    fn attach_app_webview(
        &self,
        window: &Window,
        request: WebViewRequest,
    ) -> std::result::Result<HostWebView, HostProtocolError>;

    fn capabilities(&self) -> WebViewCapabilities;
}

struct WebViewRequest {
    url: Cow<'static, str>,
}

struct SystemWebEngineProvider;

impl WebEngineProvider for SystemWebEngineProvider {
    fn attach_app_webview(
        &self,
        window: &Window,
        request: WebViewRequest,
    ) -> std::result::Result<HostWebView, HostProtocolError> {
        let builder =
            scheme::register_app_scheme(WebViewBuilder::new()).with_url(request.url.to_string());
        build_webview(builder, window).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to attach system WebView provider: {error}"),
                WEBVIEW_CREATE_OPERATION,
            )
        })
    }

    fn capabilities(&self) -> WebViewCapabilities {
        WebViewCapabilities {
            engine: WebEngineKind::System,
            available: true,
        }
    }
}

struct ChromiumWebEngineProvider;

impl WebEngineProvider for ChromiumWebEngineProvider {
    fn attach_app_webview(
        &self,
        _window: &Window,
        _request: WebViewRequest,
    ) -> std::result::Result<HostWebView, HostProtocolError> {
        Err(chromium_provider_missing_error())
    }

    fn capabilities(&self) -> WebViewCapabilities {
        WebViewCapabilities {
            engine: WebEngineKind::Chromium,
            available: false,
        }
    }
}

fn chromium_provider_missing_error() -> HostProtocolError {
    HostProtocolError::unsupported(
        "web.engine chromium was selected, but the Chromium WebView provider is not installed",
        WEBVIEW_CREATE_OPERATION,
    )
}

pub(crate) fn attach_app_webview(
    window: &Window,
) -> std::result::Result<HostWebView, HostProtocolError> {
    let engine = selected_web_engine()?;
    let url = renderer_url(std::env::var(DEV_URL_ENV).ok());
    let url_for_log = url.to_string();
    let request = WebViewRequest { url };
    let provider = provider_for(engine);
    let capabilities = provider.capabilities();
    let webview = provider.attach_app_webview(window, request)?;

    info!(
        event = WEBVIEW_OPENED_EVENT,
        engine = ?capabilities.engine,
        available = capabilities.available,
        source = scheme::APP_PROTOCOL_SOURCE_KIND,
        url = url_for_log,
        "host webview opened"
    );

    Ok(webview)
}

fn selected_web_engine() -> std::result::Result<WebEngineKind, HostProtocolError> {
    let current_exe = std::env::current_exe().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to read current executable while resolving web engine: {error}"),
            WEBVIEW_CREATE_OPERATION,
        )
    })?;
    let Some(manifest_path) = runtime::manifest_path_for_exe(&current_exe) else {
        return Ok(WebEngineKind::System);
    };
    if !manifest_path.is_file() {
        return Ok(WebEngineKind::System);
    }
    web_engine_from_manifest_path(&manifest_path)
}

fn web_engine_from_manifest_path(
    path: &Path,
) -> std::result::Result<WebEngineKind, HostProtocolError> {
    let source = std::fs::read_to_string(path).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to read app-manifest.json while resolving web engine: {error}"),
            WEBVIEW_CREATE_OPERATION,
        )
    })?;
    web_engine_from_manifest_str(&source)
}

fn web_engine_from_manifest_str(
    source: &str,
) -> std::result::Result<WebEngineKind, HostProtocolError> {
    let value: serde_json::Value = serde_json::from_str(source).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to parse app-manifest.json while resolving web engine: {error}"),
            WEBVIEW_CREATE_OPERATION,
        )
    })?;
    let Some(host_manifest) = value.get("hostManifest") else {
        return Ok(WebEngineKind::System);
    };
    let Some(web_engine) = host_manifest.get("webEngine") else {
        return Ok(WebEngineKind::System);
    };
    match web_engine.as_str() {
        Some("system") => Ok(WebEngineKind::System),
        Some("chromium") => Ok(WebEngineKind::Chromium),
        Some(other) => Err(HostProtocolError::invalid_argument(
            "hostManifest.webEngine",
            format!("must be system or chromium, got {other}"),
            WEBVIEW_CREATE_OPERATION,
        )),
        None => Err(HostProtocolError::invalid_argument(
            "hostManifest.webEngine",
            "must be a string",
            WEBVIEW_CREATE_OPERATION,
        )),
    }
}

fn provider_for(engine: WebEngineKind) -> &'static dyn WebEngineProvider {
    match engine {
        WebEngineKind::System => &SystemWebEngineProvider,
        WebEngineKind::Chromium => &ChromiumWebEngineProvider,
    }
}

fn renderer_url(dev_url: Option<String>) -> Cow<'static, str> {
    match dev_url {
        Some(url) if !url.trim().is_empty() => Cow::Owned(url),
        _ => Cow::Borrowed(scheme::APP_URL),
    }
}

#[cfg(not(target_os = "linux"))]
fn build_webview(builder: WebViewBuilder<'_>, window: &Window) -> anyhow::Result<WebView> {
    builder
        .build(window)
        .context("failed to build host webview")
}

#[cfg(target_os = "linux")]
fn build_webview(builder: WebViewBuilder<'_>, window: &Window) -> anyhow::Result<WebView> {
    use tao::platform::unix::WindowExtUnix;
    use wry::WebViewBuilderExtUnix;

    let vbox = window
        .default_vbox()
        .context("failed to build host webview: Tao window does not expose the default GTK box")?;

    builder
        .build_gtk(vbox)
        .context("failed to build host webview")
}

#[cfg(test)]
mod tests {
    use super::{
        chromium_provider_missing_error, renderer_url, web_engine_from_manifest_str, WebEngineKind,
    };
    use crate::scheme::{APP_PROTOCOL_SOURCE_KIND, APP_URL};

    #[test]
    fn webview_source_identifies_the_app_protocol_path() {
        assert_eq!(APP_PROTOCOL_SOURCE_KIND, "app-protocol");
        assert_eq!(APP_URL, "app://localhost/");
    }

    #[test]
    fn renderer_url_uses_dev_url_when_present() {
        assert_eq!(
            renderer_url(Some("http://127.0.0.1:5173/".to_string())).as_ref(),
            "http://127.0.0.1:5173/"
        );
        assert_eq!(renderer_url(Some("".to_string())).as_ref(), APP_URL);
        assert_eq!(renderer_url(None).as_ref(), APP_URL);
    }

    #[test]
    fn web_engine_defaults_to_system_when_manifest_field_is_absent() {
        assert_eq!(
            web_engine_from_manifest_str(r#"{"hostManifest":{}}"#)
                .expect("web engine should parse"),
            WebEngineKind::System
        );
        assert_eq!(
            web_engine_from_manifest_str(r#"{}"#).expect("web engine should parse"),
            WebEngineKind::System
        );
    }

    #[test]
    fn web_engine_reads_system_and_chromium_manifest_values() {
        assert_eq!(
            web_engine_from_manifest_str(r#"{"hostManifest":{"webEngine":"system"}}"#)
                .expect("system engine should parse"),
            WebEngineKind::System
        );
        assert_eq!(
            web_engine_from_manifest_str(r#"{"hostManifest":{"webEngine":"chromium"}}"#)
                .expect("chromium engine should parse"),
            WebEngineKind::Chromium
        );
    }

    #[test]
    fn web_engine_rejects_invalid_manifest_values() {
        let error = web_engine_from_manifest_str(r#"{"hostManifest":{"webEngine":"servo"}}"#)
            .expect_err("invalid engine should fail");

        assert_eq!(error.tag(), "InvalidArgument");
        assert!(format!("{error:?}").contains("hostManifest.webEngine"));
    }

    #[test]
    fn chromium_provider_reports_typed_unsupported_when_missing() {
        let error = chromium_provider_missing_error();

        assert_eq!(error.tag(), "Unsupported");
        assert!(format!("{error:?}").contains("Chromium WebView provider is not installed"));
    }
}

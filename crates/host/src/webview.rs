use crate::{runtime, scheme};
use anyhow::Context;
use host_protocol::HostProtocolError;
use std::borrow::Cow;
use std::path::Path;
use tao::window::Window;
use tracing::info;
use wry::{NewWindowFeatures, NewWindowResponse, PageLoadEvent, WebView, WebViewBuilder};

const WEBVIEW_OPENED_EVENT: &str = "host.webview.opened";
const WEBVIEW_CHILD_OPENED_EVENT: &str = "host.webview.child_opened";
const DEV_URL_ENV: &str = "EFFECT_DESKTOP_DEV_URL";
const WEBVIEW_CREATE_OPERATION: &str = host_protocol::WINDOW_CREATE_METHOD;

pub(crate) type HostWebView = WebView;
type WebViewResult<T> = std::result::Result<T, Box<HostProtocolError>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WebEngineKind {
    System,
    Chrome,
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
    ) -> WebViewResult<HostWebView>;

    fn capabilities(&self) -> WebViewCapabilities;
}

struct WebViewRequest {
    url: Cow<'static, str>,
    chrome_runtime_path: Option<String>,
}

pub(crate) struct ChildWebViewRequest {
    pub(crate) url: String,
    pub(crate) navigation_handler: Box<dyn Fn(String) -> bool>,
    pub(crate) new_window_handler: Box<dyn Fn(String, NewWindowFeatures) -> NewWindowResponse>,
    pub(crate) isolation: Option<ChildWebViewIsolation>,
    pub(crate) page_load_handler: Box<dyn Fn(PageLoadEvent, String)>,
}

pub(crate) struct ChildWebViewIsolation {
    pub(crate) initialization_script: String,
    pub(crate) ipc_handler: Box<dyn Fn(wry::http::Request<String>)>,
}

struct SystemWebEngineProvider;

impl WebEngineProvider for SystemWebEngineProvider {
    fn attach_app_webview(
        &self,
        window: &Window,
        request: WebViewRequest,
    ) -> WebViewResult<HostWebView> {
        let builder =
            scheme::register_app_scheme(WebViewBuilder::new()).with_url(request.url.to_string());
        build_webview(builder, window).map_err(|error| {
            Box::new(HostProtocolError::internal(
                format!("failed to attach system WebView provider: {error}"),
                WEBVIEW_CREATE_OPERATION,
            ))
        })
    }

    fn capabilities(&self) -> WebViewCapabilities {
        WebViewCapabilities {
            engine: WebEngineKind::System,
            available: true,
        }
    }
}

struct ChromeWebEngineProvider;

impl WebEngineProvider for ChromeWebEngineProvider {
    fn attach_app_webview(
        &self,
        _window: &Window,
        request: WebViewRequest,
    ) -> WebViewResult<HostWebView> {
        Err(chrome_provider_missing_error(
            request.chrome_runtime_path.as_deref(),
        ))
    }

    fn capabilities(&self) -> WebViewCapabilities {
        WebViewCapabilities {
            engine: WebEngineKind::Chrome,
            available: false,
        }
    }
}

fn chrome_provider_missing_error(runtime_path: Option<&str>) -> Box<HostProtocolError> {
    chrome_provider_missing_error_for_operation(runtime_path, WEBVIEW_CREATE_OPERATION)
}

fn chrome_provider_missing_error_for_operation(
    runtime_path: Option<&str>,
    operation: &'static str,
) -> Box<HostProtocolError> {
    let suffix = runtime_path
        .map(|path| format!(" at {path}"))
        .unwrap_or_default();
    Box::new(HostProtocolError::unsupported(
        format!(
            "web.engine chrome was selected, but the bundled Chromium/CEF WebView provider is not installed{suffix}"
        ),
        operation,
    ))
}

pub(crate) fn attach_app_webview(window: &Window) -> WebViewResult<HostWebView> {
    let selection = selected_web_engine()?;
    let url = renderer_url(std::env::var(DEV_URL_ENV).ok());
    let url_for_log = url.to_string();
    let request = WebViewRequest {
        url,
        chrome_runtime_path: selection.chrome_runtime_path,
    };
    let provider = provider_for(selection.kind);
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

pub(crate) fn attach_child_webview(
    window: &Window,
    request: ChildWebViewRequest,
) -> WebViewResult<HostWebView> {
    let selection = selected_web_engine_for_operation(host_protocol::WEBVIEW_CREATE_METHOD)?;
    if matches!(selection.kind, WebEngineKind::Chrome) {
        return Err(chrome_provider_missing_error_for_operation(
            selection.chrome_runtime_path.as_deref(),
            host_protocol::WEBVIEW_CREATE_METHOD,
        ));
    }

    let url_for_log = request.url.clone();
    let builder = scheme::register_app_scheme(WebViewBuilder::new())
        .with_url(request.url)
        .with_navigation_handler(request.navigation_handler)
        .with_new_window_req_handler(request.new_window_handler);
    let builder = match request.isolation {
        Some(isolation) => builder
            .with_initialization_script(isolation.initialization_script)
            .with_ipc_handler(isolation.ipc_handler),
        None => builder,
    }
    .with_on_page_load_handler(request.page_load_handler);
    let webview = build_webview(builder, window).map_err(|error| {
        Box::new(HostProtocolError::internal(
            format!("failed to attach child WebView provider: {error}"),
            host_protocol::WEBVIEW_CREATE_METHOD,
        ))
    })?;

    info!(
        event = WEBVIEW_CHILD_OPENED_EVENT,
        engine = ?selection.kind,
        source = scheme::APP_PROTOCOL_SOURCE_KIND,
        url = url_for_log,
        "host child webview opened"
    );

    Ok(webview)
}

#[allow(clippy::result_large_err)]
pub(crate) fn open_devtools(webview: &HostWebView) -> std::result::Result<(), HostProtocolError> {
    #[cfg(debug_assertions)]
    {
        webview.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = webview;
        Err(HostProtocolError::unsupported(
            "host-devtools-debug-build-only",
            host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD,
        ))
    }
}

#[allow(clippy::result_large_err)]
pub(crate) fn close_devtools(webview: &HostWebView) -> std::result::Result<(), HostProtocolError> {
    #[cfg(debug_assertions)]
    {
        webview.close_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = webview;
        Err(HostProtocolError::unsupported(
            "host-devtools-debug-build-only",
            host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
        ))
    }
}

#[allow(clippy::result_large_err)]
pub(crate) fn print(webview: &HostWebView) -> std::result::Result<(), HostProtocolError> {
    webview.print().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to print WebView: {error}"),
            host_protocol::WEBVIEW_PRINT_METHOD,
        )
    })
}

#[allow(clippy::result_large_err)]
pub(crate) fn zoom(
    webview: &HostWebView,
    scale_factor: f64,
) -> std::result::Result<(), HostProtocolError> {
    webview.zoom(scale_factor).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to zoom WebView: {error}"),
            host_protocol::WEBVIEW_SET_ZOOM_METHOD,
        )
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct WebEngineSelection {
    kind: WebEngineKind,
    chrome_runtime_path: Option<String>,
}

fn selected_web_engine() -> WebViewResult<WebEngineSelection> {
    selected_web_engine_for_operation(WEBVIEW_CREATE_OPERATION)
}

fn selected_web_engine_for_operation(operation: &'static str) -> WebViewResult<WebEngineSelection> {
    let current_exe = std::env::current_exe().map_err(|error| {
        Box::new(HostProtocolError::internal(
            format!("failed to read current executable while resolving web engine: {error}"),
            operation,
        ))
    })?;
    let Some(manifest_path) = runtime::manifest_path_for_exe(&current_exe) else {
        return Ok(WebEngineSelection {
            kind: WebEngineKind::System,
            chrome_runtime_path: None,
        });
    };
    if !manifest_path.is_file() {
        return Ok(WebEngineSelection {
            kind: WebEngineKind::System,
            chrome_runtime_path: None,
        });
    }
    web_engine_from_manifest_path(&manifest_path, operation)
}

fn web_engine_from_manifest_path(
    path: &Path,
    operation: &'static str,
) -> WebViewResult<WebEngineSelection> {
    let source = std::fs::read_to_string(path).map_err(|error| {
        Box::new(HostProtocolError::internal(
            format!("failed to read app-manifest.json while resolving web engine: {error}"),
            operation,
        ))
    })?;
    web_engine_from_manifest_str_for_operation(&source, operation)
}

#[cfg(test)]
fn web_engine_from_manifest_str(source: &str) -> WebViewResult<WebEngineSelection> {
    web_engine_from_manifest_str_for_operation(source, WEBVIEW_CREATE_OPERATION)
}

fn web_engine_from_manifest_str_for_operation(
    source: &str,
    operation: &'static str,
) -> WebViewResult<WebEngineSelection> {
    let value: serde_json::Value = serde_json::from_str(source).map_err(|error| {
        Box::new(HostProtocolError::internal(
            format!("failed to parse app-manifest.json while resolving web engine: {error}"),
            operation,
        ))
    })?;
    let Some(host_manifest) = value.get("hostManifest") else {
        return Ok(WebEngineSelection {
            kind: WebEngineKind::System,
            chrome_runtime_path: None,
        });
    };
    let Some(web_engine) = host_manifest.get("webEngine") else {
        return Ok(WebEngineSelection {
            kind: WebEngineKind::System,
            chrome_runtime_path: None,
        });
    };
    match web_engine.as_str() {
        Some("system") => Ok(WebEngineSelection {
            kind: WebEngineKind::System,
            chrome_runtime_path: None,
        }),
        Some("chrome") | Some("chromium") => Ok(WebEngineSelection {
            kind: WebEngineKind::Chrome,
            chrome_runtime_path: host_manifest
                .get("webEnginePath")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
        }),
        Some(other) => Err(Box::new(HostProtocolError::invalid_argument(
            "hostManifest.webEngine",
            format!("must be system or chrome, got {other}"),
            operation,
        ))),
        None => Err(Box::new(HostProtocolError::invalid_argument(
            "hostManifest.webEngine",
            "must be a string",
            operation,
        ))),
    }
}

fn provider_for(engine: WebEngineKind) -> &'static dyn WebEngineProvider {
    match engine {
        WebEngineKind::System => &SystemWebEngineProvider,
        WebEngineKind::Chrome => &ChromeWebEngineProvider,
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
        chrome_provider_missing_error, renderer_url, web_engine_from_manifest_str, WebEngineKind,
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
                .expect("web engine should parse")
                .kind,
            WebEngineKind::System
        );
        assert_eq!(
            web_engine_from_manifest_str(r#"{}"#)
                .expect("web engine should parse")
                .kind,
            WebEngineKind::System
        );
    }

    #[test]
    fn web_engine_reads_system_and_chrome_manifest_values() {
        assert_eq!(
            web_engine_from_manifest_str(r#"{"hostManifest":{"webEngine":"system"}}"#)
                .expect("system engine should parse")
                .kind,
            WebEngineKind::System
        );
        let chrome = web_engine_from_manifest_str(
            r#"{"hostManifest":{"webEngine":"chrome","webEnginePath":"native/chrome"}}"#,
        )
        .expect("chrome engine should parse");
        assert_eq!(chrome.kind, WebEngineKind::Chrome);
        assert_eq!(chrome.chrome_runtime_path.as_deref(), Some("native/chrome"));

        assert_eq!(
            web_engine_from_manifest_str(r#"{"hostManifest":{"webEngine":"chromium"}}"#)
                .expect("legacy chromium engine should parse")
                .kind,
            WebEngineKind::Chrome
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
    fn chrome_provider_reports_typed_unsupported_when_missing() {
        let error = chrome_provider_missing_error(Some("native/chrome"));

        assert_eq!(error.tag(), "Unsupported");
        assert!(format!("{error:?}").contains("bundled Chromium/CEF WebView provider"));
        assert!(format!("{error:?}").contains("native/chrome"));
    }
}

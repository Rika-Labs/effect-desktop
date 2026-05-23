use crate::{runtime, scheme};
use anyhow::Context;
use host_protocol::{HostProtocolEnvelope, HostProtocolError};
use std::borrow::Cow;
use std::path::Path;
use tao::window::Window;
use tracing::info;
#[cfg(target_os = "macos")]
use wry::WebViewBuilderExtDarwin;
use wry::{
    DragDropEvent, NewWindowFeatures, NewWindowResponse, PageLoadEvent, ProxyConfig, WebContext,
    WebView, WebViewBuilder,
};

const WEBVIEW_OPENED_EVENT: &str = "host.webview.opened";
const WEBVIEW_CHILD_OPENED_EVENT: &str = "host.webview.child_opened";
const DEV_URL_ENV: &str = "EFFECT_DESKTOP_DEV_URL";
const WEBVIEW_CREATE_OPERATION: &str = host_protocol::WINDOW_CREATE_METHOD;
const APP_RENDERER_RPC_IPC_KIND: &str = "orika.renderer-rpc";
const APP_RENDERER_RPC_OPERATION: &str = "host.rendererRpcTransport";
const APP_RENDERER_RPC_TRANSPORT_KEY: &str = "__ORIKA_HOST_RPC_TRANSPORT__";
#[cfg(any(not(any(debug_assertions, feature = "devtools")), test))]
const WEBVIEW_DEVTOOLS_BUILD_GATED_REASON: &str = "host-devtools-build-gated";
#[cfg(any(target_os = "windows", test))]
const WEBVIEW_CLOSE_DEVTOOLS_WINDOWS_UNAVAILABLE_REASON: &str =
    "windows-devtools-close-unavailable";

pub(crate) type HostWebView = WebView;
pub(crate) type HostWebContext = WebContext;
type WebViewResult<T> = std::result::Result<T, Box<HostProtocolError>>;
type RendererTransportResult<T> = std::result::Result<T, Box<HostProtocolError>>;

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
    transport: AppWebViewTransport,
}

pub(crate) struct AppWebViewTransport {
    pub(crate) initialization_script: String,
    pub(crate) ipc_handler: Box<dyn Fn(wry::http::Request<String>)>,
}

pub(crate) struct ChildWebViewRequest<'a> {
    pub(crate) url: String,
    pub(crate) web_context: Option<&'a mut HostWebContext>,
    pub(crate) register_app_protocols: bool,
    pub(crate) data_store_identifier: Option<[u8; 16]>,
    pub(crate) navigation_handler: Box<dyn Fn(String) -> bool>,
    pub(crate) new_window_handler: Box<dyn Fn(String, NewWindowFeatures) -> NewWindowResponse>,
    pub(crate) isolation: Option<ChildWebViewIsolation>,
    pub(crate) page_load_handler: Box<dyn Fn(PageLoadEvent, String)>,
    pub(crate) drag_drop_handler: Box<dyn Fn(DragDropEvent) -> bool>,
    pub(crate) proxy_config: Option<ProxyConfig>,
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
        let builder = scheme::register_app_scheme(WebViewBuilder::new())
            .with_url(request.url.to_string())
            .with_initialization_script(request.transport.initialization_script)
            .with_ipc_handler(request.transport.ipc_handler);
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

pub(crate) fn attach_app_webview(
    window: &Window,
    renderer_route: Option<&str>,
    transport: AppWebViewTransport,
) -> WebViewResult<HostWebView> {
    let selection = selected_web_engine()?;
    let url = renderer_url(std::env::var(DEV_URL_ENV).ok(), renderer_route);
    let url_for_log = url.to_string();
    let request = WebViewRequest {
        url,
        chrome_runtime_path: selection.chrome_runtime_path,
        transport,
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
    request: ChildWebViewRequest<'_>,
) -> WebViewResult<HostWebView> {
    let selection = selected_web_engine_for_operation(host_protocol::WEBVIEW_CREATE_METHOD)?;
    if matches!(selection.kind, WebEngineKind::Chrome) {
        return Err(chrome_provider_missing_error_for_operation(
            selection.chrome_runtime_path.as_deref(),
            host_protocol::WEBVIEW_CREATE_METHOD,
        ));
    }

    let url_for_log = request.url.clone();
    let builder = match request.web_context {
        Some(context) => WebViewBuilder::new_with_web_context(context),
        None => WebViewBuilder::new(),
    };
    let builder = if request.register_app_protocols {
        scheme::register_app_scheme(builder)
    } else {
        builder
    };
    let builder = apply_proxy_config(
        apply_profile_data_store(builder, request.data_store_identifier),
        request.proxy_config,
    )
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
    let builder = builder.with_drag_drop_handler(request.drag_drop_handler);
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

fn apply_proxy_config<'a>(
    builder: WebViewBuilder<'a>,
    proxy_config: Option<ProxyConfig>,
) -> WebViewBuilder<'a> {
    match proxy_config {
        Some(proxy_config) => builder.with_proxy_config(proxy_config),
        None => builder,
    }
}

#[cfg(target_os = "macos")]
fn apply_profile_data_store<'a>(
    builder: WebViewBuilder<'a>,
    identifier: Option<[u8; 16]>,
) -> WebViewBuilder<'a> {
    match identifier {
        Some(identifier) => builder.with_data_store_identifier(identifier),
        None => builder,
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_profile_data_store<'a>(
    builder: WebViewBuilder<'a>,
    identifier: Option<[u8; 16]>,
) -> WebViewBuilder<'a> {
    let _ = identifier;
    builder
}

#[allow(clippy::result_large_err)]
pub(crate) fn open_devtools(webview: &HostWebView) -> std::result::Result<(), HostProtocolError> {
    #[cfg(any(debug_assertions, feature = "devtools"))]
    {
        webview.open_devtools();
        Ok(())
    }
    #[cfg(not(any(debug_assertions, feature = "devtools")))]
    {
        let _ = webview;
        Err(devtools_unsupported(
            WEBVIEW_DEVTOOLS_BUILD_GATED_REASON,
            host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD,
        ))
    }
}

#[allow(clippy::result_large_err)]
pub(crate) fn close_devtools(webview: &HostWebView) -> std::result::Result<(), HostProtocolError> {
    #[cfg(target_os = "windows")]
    {
        let _ = webview;
        Err(devtools_unsupported(
            WEBVIEW_CLOSE_DEVTOOLS_WINDOWS_UNAVAILABLE_REASON,
            host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
        ))
    }
    #[cfg(all(
        not(target_os = "windows"),
        any(debug_assertions, feature = "devtools")
    ))]
    {
        webview.close_devtools();
        Ok(())
    }
    #[cfg(all(
        not(target_os = "windows"),
        not(any(debug_assertions, feature = "devtools"))
    ))]
    {
        let _ = webview;
        Err(devtools_unsupported(
            WEBVIEW_DEVTOOLS_BUILD_GATED_REASON,
            host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
        ))
    }
}

#[cfg(any(
    target_os = "windows",
    not(any(debug_assertions, feature = "devtools")),
    test
))]
fn devtools_unsupported(reason: &'static str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(reason, operation)
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

#[allow(clippy::result_large_err)]
pub(crate) fn clear_all_browsing_data(
    webview: &HostWebView,
) -> std::result::Result<(), HostProtocolError> {
    webview.clear_all_browsing_data().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to clear WebView browsing data: {error}"),
            host_protocol::BROWSING_DATA_CLEAR_METHOD,
        )
    })
}

#[allow(clippy::result_large_err)]
pub(crate) fn cookies_for_url(
    webview: &HostWebView,
    url: &str,
    operation: &'static str,
) -> std::result::Result<Vec<wry::cookie::Cookie<'static>>, HostProtocolError> {
    webview.cookies_for_url(url).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to read WebView cookies: {error}"),
            operation,
        )
    })
}

#[allow(clippy::result_large_err)]
pub(crate) fn set_cookie(
    webview: &HostWebView,
    cookie: &wry::cookie::Cookie<'_>,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    webview.set_cookie(cookie).map_err(|error| {
        HostProtocolError::internal(format!("failed to set WebView cookie: {error}"), operation)
    })
}

#[allow(clippy::result_large_err)]
pub(crate) fn delete_cookie(
    webview: &HostWebView,
    cookie: &wry::cookie::Cookie<'_>,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    webview.delete_cookie(cookie).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to delete WebView cookie: {error}"),
            operation,
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

fn renderer_url(dev_url: Option<String>, renderer_route: Option<&str>) -> Cow<'static, str> {
    let route = renderer_route.and_then(normalize_renderer_route);
    match dev_url {
        Some(url) if !url.trim().is_empty() => Cow::Owned(append_renderer_route(
            url.trim_end_matches('/'),
            route.as_deref(),
        )),
        _ => route
            .map(|route| Cow::Owned(format!("app://localhost{route}")))
            .unwrap_or(Cow::Borrowed(scheme::APP_URL)),
    }
}

fn normalize_renderer_route(route: &str) -> Option<String> {
    let trimmed = route.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    })
}

fn append_renderer_route(base: &str, route: Option<&str>) -> String {
    match route {
        Some(route) => format!("{base}{route}"),
        None => base.to_string(),
    }
}

pub(crate) fn app_webview_transport_script(window_id: &str) -> String {
    let window_id_json = serde_json::json!(window_id).to_string();
    format!(
        r#"(() => {{
  const rawIpc = window.ipc;
  if (rawIpc === undefined || typeof rawIpc.postMessage !== "function") {{
    return;
  }}
  const windowId = {window_id_json};
  const listeners = new Set();
  const transport = Object.freeze({{
    send(envelope) {{
      const outgoing = envelope && typeof envelope === "object" && !Array.isArray(envelope)
        ? {{ ...envelope }}
        : envelope;
      if (
        outgoing &&
        typeof outgoing === "object" &&
        outgoing.kind === "request" &&
        outgoing.windowId === undefined
      ) {{
        outgoing.windowId = windowId;
      }}
      rawIpc.postMessage(JSON.stringify({{
        kind: "{APP_RENDERER_RPC_IPC_KIND}",
        envelope: outgoing
      }}));
    }},
    subscribe(listener) {{
      if (typeof listener !== "function") {{
        throw new TypeError("renderer RPC listener must be a function");
      }}
      listeners.add(listener);
      return () => {{
        listeners.delete(listener);
      }};
    }},
    receive(envelope) {{
      for (const listener of Array.from(listeners)) {{
        listener(envelope);
      }}
    }}
  }});
  Object.defineProperty(window, "{APP_RENDERER_RPC_TRANSPORT_KEY}", {{
    configurable: false,
    enumerable: false,
    writable: false,
    value: transport
  }});
  try {{
    Object.defineProperty(window, "ipc", {{
      configurable: false,
      enumerable: false,
      writable: false,
      value: undefined
    }});
  }} catch (_error) {{}}
}})();"#
    )
}

pub(crate) fn decode_app_webview_transport_ipc(
    body: &str,
) -> RendererTransportResult<Option<HostProtocolEnvelope>> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return Ok(None);
    };
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    if object.get("kind").and_then(serde_json::Value::as_str) != Some(APP_RENDERER_RPC_IPC_KIND) {
        return Ok(None);
    }
    let Some(envelope_value) = object.get("envelope") else {
        return Err(Box::new(HostProtocolError::invalid_argument(
            "envelope",
            "missing renderer transport envelope",
            APP_RENDERER_RPC_OPERATION,
        )));
    };
    let envelope = serde_json::from_value::<HostProtocolEnvelope>(envelope_value.clone()).map_err(
        |error| {
            Box::new(HostProtocolError::invalid_argument(
                "envelope",
                format!("invalid renderer transport envelope: {error}"),
                APP_RENDERER_RPC_OPERATION,
            ))
        },
    )?;
    match &envelope {
        HostProtocolEnvelope::Request { .. } | HostProtocolEnvelope::Cancel { .. } => {
            Ok(Some(envelope))
        }
        _ => Err(Box::new(HostProtocolError::invalid_argument(
            "envelope.kind",
            "must be request or cancel",
            APP_RENDERER_RPC_OPERATION,
        ))),
    }
}

pub(crate) fn renderer_transport_delivery_script(
    frames: &[HostProtocolEnvelope],
) -> RendererTransportResult<String> {
    let frames_json = serde_json::to_string(frames).map_err(|error| {
        Box::new(HostProtocolError::invalid_output(
            APP_RENDERER_RPC_OPERATION,
            error.to_string(),
        ))
    })?;
    Ok(format!(
        r#"(() => {{
  const transport = window.{APP_RENDERER_RPC_TRANSPORT_KEY};
  if (transport === undefined || typeof transport.receive !== "function") {{
    return;
  }}
  for (const envelope of {frames_json}) {{
    transport.receive(envelope);
  }}
}})();"#
    ))
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
        app_webview_transport_script, chrome_provider_missing_error,
        decode_app_webview_transport_ipc, devtools_unsupported, renderer_transport_delivery_script,
        renderer_url, web_engine_from_manifest_str, WebEngineKind,
        WEBVIEW_CLOSE_DEVTOOLS_WINDOWS_UNAVAILABLE_REASON, WEBVIEW_DEVTOOLS_BUILD_GATED_REASON,
    };
    use crate::scheme::{APP_PROTOCOL_SOURCE_KIND, APP_URL};
    use host_protocol::{HostProtocolEnvelope, HostProtocolError};

    #[test]
    fn webview_source_identifies_the_app_protocol_path() {
        assert_eq!(APP_PROTOCOL_SOURCE_KIND, "app-protocol");
        assert_eq!(APP_URL, "app://localhost/");
    }

    #[test]
    fn app_webview_transport_script_installs_renderer_rpc_transport_before_app_code() {
        let script = app_webview_transport_script("window-1");

        assert!(script.contains("__ORIKA_HOST_RPC_TRANSPORT__"));
        assert!(script.contains("orika.renderer-rpc"));
        assert!(script.contains(r#""window-1""#));
        assert!(script.contains("window.ipc"));
        assert!(script.contains(r#"Object.defineProperty(window, "ipc""#));
    }

    #[test]
    fn app_webview_transport_ipc_decodes_renderer_protocol_frames() {
        let decoded = decode_app_webview_transport_ipc(
            r#"{"kind":"orika.renderer-rpc","envelope":{"kind":"request","id":"request-1","method":"Window.getCurrent","timestamp":1,"traceId":"trace-request"}}"#,
        )
        .expect("renderer transport ipc should decode")
        .expect("renderer transport ipc should carry an envelope");

        assert_eq!(
            decoded,
            HostProtocolEnvelope::Request {
                id: "request-1".to_string(),
                method: host_protocol::WINDOW_GET_CURRENT_METHOD.to_string(),
                timestamp: 1,
                trace_id: "trace-request".to_string(),
                window_id: None,
                origin_token: None,
                payload: None,
            }
        );
        assert!(
            decode_app_webview_transport_ipc(r#"{"kind":"effect-desktop.webview-api"}"#)
                .expect("unrelated ipc should not fail")
                .is_none()
        );
    }

    #[test]
    fn renderer_transport_delivery_script_forwards_frames_to_installed_transport() {
        let script = renderer_transport_delivery_script(&[HostProtocolEnvelope::Response {
            id: "request-1".to_string(),
            timestamp: 2,
            trace_id: "trace-response".to_string(),
            payload: Some(serde_json::json!("pong")),
            error: None,
        }])
        .expect("renderer transport delivery script should encode");

        assert!(script.contains("__ORIKA_HOST_RPC_TRANSPORT__"));
        assert!(script.contains(r#""kind":"response""#));
        assert!(script.contains(".receive(envelope)"));
    }

    #[test]
    fn renderer_url_uses_dev_url_when_present() {
        assert_eq!(
            renderer_url(Some("http://127.0.0.1:5173/".to_string()), Some("/compose")).as_ref(),
            "http://127.0.0.1:5173/compose"
        );
        assert_eq!(
            renderer_url(Some("".to_string()), Some("/compose")).as_ref(),
            "app://localhost/compose"
        );
        assert_eq!(
            renderer_url(None, Some("compose")).as_ref(),
            "app://localhost/compose"
        );
        assert_eq!(renderer_url(None, None).as_ref(), APP_URL);
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

    #[test]
    fn devtools_unsupported_errors_report_stable_reasons() {
        for (reason, operation) in [
            (
                WEBVIEW_DEVTOOLS_BUILD_GATED_REASON,
                host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD,
            ),
            (
                WEBVIEW_CLOSE_DEVTOOLS_WINDOWS_UNAVAILABLE_REASON,
                host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
            ),
        ] {
            let error = devtools_unsupported(reason, operation);
            match error {
                HostProtocolError::Unsupported {
                    reason: actual_reason,
                    operation: actual_operation,
                    ..
                } => {
                    assert_eq!(actual_reason, reason);
                    assert_eq!(actual_operation, operation);
                }
                other => panic!("expected Unsupported, got {other:?}"),
            }
        }
    }
}

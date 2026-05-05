use crate::scheme;
use anyhow::{Context, Result};
use tao::window::Window;
use tracing::info;
use wry::{WebView, WebViewBuilder};

const WEBVIEW_OPENED_EVENT: &str = "host.webview.opened";

pub(crate) fn attach_app_webview(window: &Window) -> Result<WebView> {
    let builder = scheme::register_app_scheme(WebViewBuilder::new()).with_url(scheme::APP_URL);
    let webview = build_webview(builder, window)?;

    info!(
        event = WEBVIEW_OPENED_EVENT,
        source = scheme::APP_PROTOCOL_SOURCE_KIND,
        url = scheme::APP_URL,
        "host webview opened"
    );

    Ok(webview)
}

#[cfg(not(target_os = "linux"))]
fn build_webview(builder: WebViewBuilder<'_>, window: &Window) -> Result<WebView> {
    builder
        .build(window)
        .context("failed to build host webview")
}

#[cfg(target_os = "linux")]
fn build_webview(builder: WebViewBuilder<'_>, window: &Window) -> Result<WebView> {
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
    use crate::scheme::{APP_PROTOCOL_SOURCE_KIND, APP_URL};

    #[test]
    fn webview_source_identifies_the_app_protocol_path() {
        assert_eq!(APP_PROTOCOL_SOURCE_KIND, "app-protocol");
        assert_eq!(APP_URL, "app://localhost/");
    }
}

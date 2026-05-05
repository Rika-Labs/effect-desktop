use anyhow::{Context, Result};
use tao::window::Window;
use tracing::info;
use wry::{WebView, WebViewBuilder};

// WRY 0.55 documents data URLs as unsupported in `with_url`; use inline HTML
// until the next milestone replaces this probe with `app://`.
const HELLO_HTML: &str = r#"<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Effect Desktop</title>
  </head>
  <body>
    <h1>hello</h1>
  </body>
</html>"#;
const WEBVIEW_OPENED_EVENT: &str = "host.webview.opened";
const WEBVIEW_SOURCE_KIND: &str = "inline-html";

pub(crate) fn attach_hello_webview(window: &Window) -> Result<WebView> {
    let webview = build_webview(WebViewBuilder::new().with_html(HELLO_HTML), window)?;

    info!(
        event = WEBVIEW_OPENED_EVENT,
        source = WEBVIEW_SOURCE_KIND,
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
    use super::{HELLO_HTML, WEBVIEW_SOURCE_KIND};

    #[test]
    fn hello_html_renders_the_phase_one_probe() {
        assert!(HELLO_HTML.contains("<h1>hello</h1>"));
        assert!(HELLO_HTML.contains("<!doctype html>"));
    }

    #[test]
    fn hello_html_does_not_use_future_protocol_or_remote_sources() {
        assert!(!HELLO_HTML.contains("app://"));
        assert!(!HELLO_HTML.contains("http://"));
        assert!(!HELLO_HTML.contains("https://"));
        assert!(!HELLO_HTML.contains("data:text/html"));
    }

    #[test]
    fn source_kind_identifies_the_supported_wry_loading_path() {
        assert_eq!(WEBVIEW_SOURCE_KIND, "inline-html");
    }
}

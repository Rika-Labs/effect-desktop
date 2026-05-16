#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::HostProtocolError;
use serde_json::{json, Value};
#[cfg(target_os = "linux")]
use std::env;
#[cfg(target_os = "linux")]
use std::process::Command;

#[cfg(target_os = "linux")]
const WAYLAND_GLOBAL_SHORTCUT_REASON: &str = "wayland-no-global-shortcut";
const HOST_ADAPTER_UNIMPLEMENTED_REASON: &str = "host-adapter-unimplemented";

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LinuxSession {
    Wayland,
    X11,
    Unknown,
}

#[cfg(any(target_os = "linux", test))]
impl LinuxSession {
    #[cfg(target_os = "linux")]
    fn detect() -> Self {
        Self::from_value(env::var("XDG_SESSION_TYPE").ok().as_deref())
    }

    fn from_value(value: Option<&str>) -> Self {
        match value.map(str::to_ascii_lowercase).as_deref() {
            Some("wayland") => Self::Wayland,
            Some("x11") => Self::X11,
            _ => Self::Unknown,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DockMethod {
    SetBadgeCount,
    SetBadgeText,
    SetProgress,
    SetMenu,
    SetJumpList,
    RequestAttention,
}

pub(crate) fn global_shortcut_is_supported() -> Result<Option<Value>, HostProtocolError> {
    Ok(Some(global_shortcut_support_payload()))
}

pub(crate) fn unsupported_global_shortcut(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(global_shortcut_unsupported_reason(), operation)
}

pub(crate) fn global_shortcut_is_registered() -> Result<Option<Value>, HostProtocolError> {
    Ok(Some(json!({ "registered": false })))
}

pub(crate) fn safe_storage_is_available() -> Result<Option<Value>, HostProtocolError> {
    Ok(Some(json!({ "available": secret_service_available() })))
}

pub(crate) fn dock_is_supported(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let method = decode_method(payload)?;
    Ok(Some(json!({ "supported": dock_method_supported(&method) })))
}

fn decode_method(payload: Option<Value>) -> Result<String, HostProtocolError> {
    let Some(payload) = payload else {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "is required",
            host_protocol::DOCK_IS_SUPPORTED_METHOD,
        ));
    };
    match payload.get("method") {
        Some(Value::String(method)) => parse_dock_method(method).map(|_| method.clone()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "method",
            "must be a string",
            host_protocol::DOCK_IS_SUPPORTED_METHOD,
        )),
        None => Err(HostProtocolError::invalid_argument(
            "method",
            "is required",
            host_protocol::DOCK_IS_SUPPORTED_METHOD,
        )),
    }
}

fn parse_dock_method(method: &str) -> Result<DockMethod, HostProtocolError> {
    match method {
        "setBadgeCount" => Ok(DockMethod::SetBadgeCount),
        "setBadgeText" => Ok(DockMethod::SetBadgeText),
        "setProgress" => Ok(DockMethod::SetProgress),
        "setMenu" => Ok(DockMethod::SetMenu),
        "setJumpList" => Ok(DockMethod::SetJumpList),
        "requestAttention" => Ok(DockMethod::RequestAttention),
        _ => Err(HostProtocolError::invalid_argument(
            "method",
            "must be a known Dock method",
            host_protocol::DOCK_IS_SUPPORTED_METHOD,
        )),
    }
}

fn dock_method_supported(method: &str) -> bool {
    platform_dock_method_supported(method)
}

#[cfg(target_os = "linux")]
fn global_shortcut_support_payload() -> Value {
    match LinuxSession::detect() {
        LinuxSession::Wayland => json!({
            "supported": false,
            "reason": WAYLAND_GLOBAL_SHORTCUT_REASON
        }),
        LinuxSession::X11 => json!({ "supported": true }),
        LinuxSession::Unknown => json!({
            "supported": false,
            "reason": HOST_ADAPTER_UNIMPLEMENTED_REASON
        }),
    }
}

#[cfg(not(target_os = "linux"))]
fn global_shortcut_support_payload() -> Value {
    json!({
        "supported": false,
        "reason": HOST_ADAPTER_UNIMPLEMENTED_REASON
    })
}

#[cfg(target_os = "linux")]
fn global_shortcut_unsupported_reason() -> &'static str {
    match LinuxSession::detect() {
        LinuxSession::Wayland => WAYLAND_GLOBAL_SHORTCUT_REASON,
        LinuxSession::X11 | LinuxSession::Unknown => HOST_ADAPTER_UNIMPLEMENTED_REASON,
    }
}

#[cfg(not(target_os = "linux"))]
fn global_shortcut_unsupported_reason() -> &'static str {
    HOST_ADAPTER_UNIMPLEMENTED_REASON
}

#[cfg(target_os = "linux")]
fn secret_service_available() -> bool {
    if env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() {
        return false;
    }

    Command::new("dbus-send")
        .args([
            "--session",
            "--dest=org.freedesktop.secrets",
            "--type=method_call",
            "--print-reply",
            "/org/freedesktop/secrets",
            "org.freedesktop.DBus.Peer.Ping",
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
fn secret_service_available() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn platform_dock_method_supported(method: &str) -> bool {
    matches!(
        method,
        "setBadgeCount" | "setBadgeText" | "requestAttention"
    )
}

#[cfg(target_os = "windows")]
fn platform_dock_method_supported(method: &str) -> bool {
    matches!(method, "requestAttention")
}

#[cfg(target_os = "linux")]
fn platform_dock_method_supported(method: &str) -> bool {
    matches!(method, "requestAttention")
}

#[cfg(test)]
mod tests {
    use super::{decode_method, dock_method_supported, LinuxSession};
    use serde_json::json;

    #[test]
    fn detects_wayland_sessions() {
        assert_eq!(
            LinuxSession::from_value(Some("wayland")),
            LinuxSession::Wayland
        );
        assert_eq!(
            LinuxSession::from_value(Some("WAYLAND")),
            LinuxSession::Wayland
        );
    }

    #[test]
    fn detects_x11_sessions() {
        assert_eq!(LinuxSession::from_value(Some("x11")), LinuxSession::X11);
    }

    #[test]
    fn unknown_sessions_are_not_treated_as_x11() {
        assert_eq!(LinuxSession::from_value(None), LinuxSession::Unknown);
        assert_eq!(LinuxSession::from_value(Some("tty")), LinuxSession::Unknown);
    }

    #[test]
    fn dock_support_matches_current_platform_rows() {
        #[cfg(target_os = "macos")]
        {
            assert!(dock_method_supported("setBadgeCount"));
            assert!(dock_method_supported("setBadgeText"));
            assert!(dock_method_supported("requestAttention"));
            assert!(!dock_method_supported("setProgress"));
            assert!(!dock_method_supported("setMenu"));
            assert!(!dock_method_supported("setJumpList"));
        }

        #[cfg(target_os = "windows")]
        {
            assert!(dock_method_supported("requestAttention"));
            assert!(!dock_method_supported("setBadgeCount"));
            assert!(!dock_method_supported("setBadgeText"));
            assert!(!dock_method_supported("setProgress"));
            assert!(!dock_method_supported("setMenu"));
            assert!(!dock_method_supported("setJumpList"));
        }

        #[cfg(target_os = "linux")]
        {
            assert!(dock_method_supported("requestAttention"));
            assert!(!dock_method_supported("setBadgeCount"));
            assert!(!dock_method_supported("setBadgeText"));
            assert!(!dock_method_supported("setProgress"));
            assert!(!dock_method_supported("setMenu"));
            assert!(!dock_method_supported("setJumpList"));
        }
    }

    #[test]
    fn dock_support_rejects_blank_and_unknown_methods() {
        assert!(decode_method(Some(json!({ "method": "" }))).is_err());
        assert!(decode_method(Some(json!({ "method": "missing" }))).is_err());
        assert_eq!(
            decode_method(Some(json!({ "method": "setBadgeCount" }))).expect("method"),
            "setBadgeCount"
        );
    }
}

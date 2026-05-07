#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::HostProtocolError;
use serde_json::{json, Value};
use std::{env, process::Command};

const WAYLAND_GLOBAL_SHORTCUT_REASON: &str = "wayland-no-global-shortcut";
const HOST_ADAPTER_UNIMPLEMENTED_REASON: &str = "host-adapter-unimplemented";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LinuxSession {
    Wayland,
    X11,
    Unknown,
}

impl LinuxSession {
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

pub(crate) fn global_shortcut_is_supported() -> Result<Option<Value>, HostProtocolError> {
    Ok(Some(match LinuxSession::detect() {
        LinuxSession::Wayland => json!({
            "supported": false,
            "reason": WAYLAND_GLOBAL_SHORTCUT_REASON
        }),
        LinuxSession::X11 => json!({ "supported": true }),
        LinuxSession::Unknown => json!({
            "supported": false,
            "reason": HOST_ADAPTER_UNIMPLEMENTED_REASON
        }),
    }))
}

pub(crate) fn unsupported_global_shortcut(operation: &'static str) -> HostProtocolError {
    let reason = match LinuxSession::detect() {
        LinuxSession::Wayland => WAYLAND_GLOBAL_SHORTCUT_REASON,
        LinuxSession::X11 | LinuxSession::Unknown => HOST_ADAPTER_UNIMPLEMENTED_REASON,
    };
    HostProtocolError::unsupported(reason, operation)
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
        Some(Value::String(method)) => Ok(method.clone()),
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

fn dock_method_supported(method: &str) -> bool {
    matches!(method, "setBadgeCount" | "setProgress" | "requestAttention")
}

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

#[cfg(test)]
mod tests {
    use super::{dock_method_supported, LinuxSession};

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
    fn linux_dock_support_matches_appendix_k_rows() {
        assert!(dock_method_supported("setBadgeCount"));
        assert!(dock_method_supported("setProgress"));
        assert!(dock_method_supported("requestAttention"));
        assert!(!dock_method_supported("setBadgeText"));
        assert!(!dock_method_supported("setMenu"));
        assert!(!dock_method_supported("setJumpList"));
    }
}

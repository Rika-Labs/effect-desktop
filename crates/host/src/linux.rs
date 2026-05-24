#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::HostProtocolError;
use serde_json::{json, Value};
#[cfg(target_os = "linux")]
use std::env;
#[cfg(target_os = "linux")]
use tao::{monitor::MonitorHandle, platform::unix::MonitorHandleExtUnix};

#[cfg(any(target_os = "linux", test))]
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

pub(crate) fn global_shortcut_is_supported() -> Result<Option<Value>, HostProtocolError> {
    Ok(Some(global_shortcut_support_payload()))
}

pub(crate) fn global_shortcut_is_registered() -> Result<Option<Value>, HostProtocolError> {
    Ok(Some(json!({ "registered": false })))
}

#[cfg(target_os = "linux")]
pub(crate) fn screen_work_area(monitor: &MonitorHandle) -> Option<LinuxScreenWorkArea> {
    use gtk::gdk::prelude::MonitorExt;

    let scale = monitor.scale_factor();
    let work_area = monitor.gdk_monitor().workarea();
    LinuxScreenWorkArea::from_logical_rect(
        work_area.x(),
        work_area.y(),
        work_area.width(),
        work_area.height(),
        scale,
    )
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn screen_work_area(
    _monitor: &tao::monitor::MonitorHandle,
) -> Option<LinuxScreenWorkArea> {
    None
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LinuxScreenWorkArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl LinuxScreenWorkArea {
    #[cfg_attr(not(any(test, target_os = "linux")), allow(dead_code))]
    fn from_logical_rect(x: i32, y: i32, width: i32, height: i32, scale: f64) -> Option<Self> {
        if width < 0 || height < 0 || !scale.is_finite() || scale <= 0.0 {
            return None;
        }

        Some(Self {
            x: f64::from(x) * scale,
            y: f64::from(y) * scale,
            width: f64::from(width) * scale,
            height: f64::from(height) * scale,
        })
    }

    pub(crate) fn x(&self) -> f64 {
        self.x
    }

    pub(crate) fn y(&self) -> f64 {
        self.y
    }

    pub(crate) fn width(&self) -> f64 {
        self.width
    }

    pub(crate) fn height(&self) -> f64 {
        self.height
    }
}

#[cfg(target_os = "linux")]
fn global_shortcut_support_payload() -> Value {
    support_payload_for_session(LinuxSession::detect())
}

#[cfg(any(target_os = "linux", test))]
fn support_payload_for_session(session: LinuxSession) -> Value {
    match session {
        LinuxSession::Wayland => json!({
            "supported": false,
            "reason": WAYLAND_GLOBAL_SHORTCUT_REASON
        }),
        LinuxSession::X11 | LinuxSession::Unknown => json!({
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

#[cfg(test)]
mod tests {
    use super::{
        support_payload_for_session, LinuxScreenWorkArea, LinuxSession,
        HOST_ADAPTER_UNIMPLEMENTED_REASON,
    };
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
    fn x11_global_shortcut_support_remains_unimplemented_until_adapter_exists() {
        assert_eq!(
            support_payload_for_session(LinuxSession::X11),
            json!({
                "supported": false,
                "reason": HOST_ADAPTER_UNIMPLEMENTED_REASON
            })
        );
    }

    #[test]
    fn unknown_sessions_are_not_treated_as_x11() {
        assert_eq!(LinuxSession::from_value(None), LinuxSession::Unknown);
        assert_eq!(LinuxSession::from_value(Some("tty")), LinuxSession::Unknown);
    }

    #[test]
    fn linux_work_area_converts_gdk_logical_rect_to_physical_area() {
        let area = LinuxScreenWorkArea::from_logical_rect(10, 20, 1440, 876, 2.0)
            .expect("logical work area should convert");

        assert_eq!(area.x(), 20.0);
        assert_eq!(area.y(), 40.0);
        assert_eq!(area.width(), 2880.0);
        assert_eq!(area.height(), 1752.0);
    }

    #[test]
    fn linux_work_area_rejects_invalid_geometry() {
        assert!(LinuxScreenWorkArea::from_logical_rect(0, 0, -1, 100, 1.0).is_none());
        assert!(LinuxScreenWorkArea::from_logical_rect(0, 0, 100, -1, 1.0).is_none());
        assert!(LinuxScreenWorkArea::from_logical_rect(0, 0, 100, 100, 0.0).is_none());
        assert!(LinuxScreenWorkArea::from_logical_rect(0, 0, 100, 100, f64::NAN).is_none());
    }
}

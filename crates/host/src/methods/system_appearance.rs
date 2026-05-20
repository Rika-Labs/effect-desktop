#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolEnvelope, HostProtocolError, SystemAppearanceAccentColorPayload,
    SystemAppearanceBooleanPayload, SystemAppearanceChangedPayload, SystemAppearanceColorPayload,
    SystemAppearanceIsSupportedPayload, SystemAppearanceMethodPayload, SystemAppearanceModePayload,
    SystemAppearanceResultPayload, SystemAppearanceSupportedPayload,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{to_value, Value};
use std::sync::mpsc::Sender;
use tracing::info;

const SYSTEM_APPEARANCE_SMOKE_OPERATION: &str = "SystemAppearance.smoke";
#[cfg(any(test, target_os = "windows"))]
const WINDOWS_COLOR_CHANNEL_MAX: f64 = 255.0;

pub(crate) fn get_appearance(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
    )?;
    encode_payload(
        SystemAppearanceResultPayload::new(
            snapshot(host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD)?.appearance,
        ),
        host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
    )
}

pub(crate) fn get_accent_color(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::SYSTEM_APPEARANCE_GET_ACCENT_COLOR_METHOD,
    )?;
    encode_payload(
        SystemAppearanceAccentColorPayload::new(
            snapshot(host_protocol::SYSTEM_APPEARANCE_GET_ACCENT_COLOR_METHOD)?.accent_color,
        ),
        host_protocol::SYSTEM_APPEARANCE_GET_ACCENT_COLOR_METHOD,
    )
}

pub(crate) fn get_reduced_motion(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_MOTION_METHOD,
    )?;
    encode_payload(
        SystemAppearanceBooleanPayload::new(
            snapshot(host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_MOTION_METHOD)?.reduced_motion,
        ),
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_MOTION_METHOD,
    )
}

pub(crate) fn get_reduced_transparency(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_TRANSPARENCY_METHOD,
    )?;
    encode_payload(
        SystemAppearanceBooleanPayload::new(
            snapshot(host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_TRANSPARENCY_METHOD)?
                .reduced_transparency,
        ),
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_TRANSPARENCY_METHOD,
    )
}

pub(crate) fn is_supported(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<SystemAppearanceIsSupportedPayload>(
        payload,
        host_protocol::SYSTEM_APPEARANCE_IS_SUPPORTED_METHOD,
    )?;
    encode_payload(
        if supports_method(input.method()) {
            SystemAppearanceSupportedPayload::supported()
        } else {
            SystemAppearanceSupportedPayload::unsupported()
        },
        host_protocol::SYSTEM_APPEARANCE_IS_SUPPORTED_METHOD,
    )
}

pub(crate) fn install_runtime_event_sender(
    sender: Sender<HostProtocolEnvelope>,
) -> Result<(), HostProtocolError> {
    platform_events::install_runtime_event_sender(sender)
}

pub(crate) fn clear_runtime_event_sender() -> Result<(), HostProtocolError> {
    platform_events::clear_runtime_event_sender()
}

pub(crate) fn run_main_thread_smoke() -> Result<(), HostProtocolError> {
    let appearance = require_smoke_payload(get_appearance(None)?, "appearance")?;
    let accent_color = require_smoke_payload(get_accent_color(None)?, "accentColor")?;
    let reduced_motion = require_smoke_payload(get_reduced_motion(None)?, "reducedMotion")?;
    let reduced_transparency =
        require_smoke_payload(get_reduced_transparency(None)?, "reducedTransparency")?;
    let supported = require_smoke_payload(
        is_supported(Some(
            to_value(SystemAppearanceIsSupportedPayload::new(
                SystemAppearanceMethodPayload::GetAppearance,
            ))
            .map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to encode system appearance smoke support query: {error}"),
                    SYSTEM_APPEARANCE_SMOKE_OPERATION,
                )
            })?,
        ))?,
        "supported",
    )?;

    info!(
        event = "host.system_appearance.smoke_verified",
        appearance = %appearance,
        accent_color = %accent_color,
        reduced_motion = %reduced_motion,
        reduced_transparency = %reduced_transparency,
        supported = %supported,
        "system appearance smoke verified"
    );
    Ok(())
}

fn require_smoke_payload(
    payload: Option<Value>,
    field: &'static str,
) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| {
        HostProtocolError::internal(
            format!("system appearance smoke missing {field} payload"),
            SYSTEM_APPEARANCE_SMOKE_OPERATION,
        )
    })
}

fn reject_unexpected_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.is_some() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        ));
    }
    Ok(())
}

fn decode_payload<T: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    let payload = payload
        .ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))?;
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode system appearance payload: {error}"),
            operation,
        )
    })
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn event_frame(
    snapshot: SystemAppearanceSnapshot,
) -> Result<HostProtocolEnvelope, HostProtocolError> {
    Ok(HostProtocolEnvelope::Event {
        method: host_protocol::SYSTEM_APPEARANCE_APPEARANCE_CHANGED_EVENT.to_string(),
        timestamp: timestamp_millis(host_protocol::SYSTEM_APPEARANCE_APPEARANCE_CHANGED_EVENT)?,
        trace_id: "host-system-appearance".to_string(),
        window_id: None,
        payload: Some(
            to_value(SystemAppearanceChangedPayload::new(
                snapshot.appearance,
                snapshot.accent_color,
                snapshot.reduced_motion,
                snapshot.reduced_transparency,
            ))
            .map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to encode system appearance event payload: {error}"),
                    host_protocol::SYSTEM_APPEARANCE_APPEARANCE_CHANGED_EVENT,
                )
            })?,
        ),
    })
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn send_snapshot_event(sender: &Sender<HostProtocolEnvelope>, snapshot: SystemAppearanceSnapshot) {
    match event_frame(snapshot) {
        Ok(frame) => {
            if sender.send(frame).is_err() {
                tracing::debug!("dropped system appearance event after runtime disconnect");
            }
        }
        Err(error) => {
            tracing::warn!(error = ?error, "failed to encode system appearance event");
        }
    }
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn timestamp_millis(operation: &'static str) -> Result<u64, HostProtocolError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("system time is before Unix epoch: {error}"),
                operation,
            )
        })
}

#[cfg(any(test, not(any(target_os = "macos", target_os = "windows"))))]
fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::SYSTEM_APPEARANCE_UNSUPPORTED_REASON,
        operation,
    )
}

fn supports_method(method: SystemAppearanceMethodPayload) -> bool {
    match method {
        SystemAppearanceMethodPayload::GetAppearance
        | SystemAppearanceMethodPayload::GetAccentColor
        | SystemAppearanceMethodPayload::GetReducedMotion
        | SystemAppearanceMethodPayload::GetReducedTransparency => has_host_snapshot(),
        SystemAppearanceMethodPayload::OnAppearanceChanged => has_event_stream(),
    }
}

#[cfg(all(any(target_os = "macos", target_os = "windows"), not(test)))]
fn has_host_snapshot() -> bool {
    true
}

#[cfg(not(all(any(target_os = "macos", target_os = "windows"), not(test))))]
fn has_host_snapshot() -> bool {
    test_snapshot().is_some()
}

#[cfg(all(any(target_os = "macos", target_os = "windows"), not(test)))]
fn has_event_stream() -> bool {
    true
}

#[cfg(not(all(any(target_os = "macos", target_os = "windows"), not(test))))]
fn has_event_stream() -> bool {
    test_snapshot().is_some()
}

fn snapshot(operation: &'static str) -> Result<SystemAppearanceSnapshot, HostProtocolError> {
    if let Some(snapshot) = test_snapshot() {
        return Ok(snapshot);
    }

    #[cfg(all(target_os = "macos", not(test)))]
    {
        macos_system_appearance::snapshot(operation)
    }

    #[cfg(all(target_os = "windows", not(test)))]
    {
        windows_system_appearance::snapshot(operation)
    }

    #[cfg(not(all(any(target_os = "macos", target_os = "windows"), not(test))))]
    {
        Err(unsupported(operation))
    }
}

#[derive(Clone, Debug, PartialEq)]
struct SystemAppearanceSnapshot {
    appearance: SystemAppearanceModePayload,
    accent_color: Option<SystemAppearanceColorPayload>,
    reduced_motion: bool,
    reduced_transparency: bool,
}

#[cfg(not(test))]
fn test_snapshot() -> Option<SystemAppearanceSnapshot> {
    None
}

#[cfg(test)]
thread_local! {
    static TEST_SYSTEM_APPEARANCE: std::cell::RefCell<Option<SystemAppearanceSnapshot>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn test_snapshot() -> Option<SystemAppearanceSnapshot> {
    TEST_SYSTEM_APPEARANCE.with(|state| state.borrow().clone())
}

#[cfg(all(target_os = "macos", not(test)))]
mod macos_system_appearance {
    use super::{HostProtocolError, SystemAppearanceSnapshot};
    use host_protocol::{SystemAppearanceColorPayload, SystemAppearanceModePayload};
    use objc2_app_kit::{NSColor, NSColorType, NSWorkspace};
    use objc2_foundation::{ns_string, NSUserDefaults};

    pub(super) fn snapshot(
        _operation: &'static str,
    ) -> Result<SystemAppearanceSnapshot, HostProtocolError> {
        let workspace = NSWorkspace::sharedWorkspace();
        let defaults = NSUserDefaults::standardUserDefaults();

        Ok(SystemAppearanceSnapshot {
            appearance: appearance_mode(&workspace, &defaults),
            accent_color: accent_color(),
            reduced_motion: workspace.accessibilityDisplayShouldReduceMotion(),
            reduced_transparency: workspace.accessibilityDisplayShouldReduceTransparency(),
        })
    }

    fn appearance_mode(
        workspace: &NSWorkspace,
        defaults: &NSUserDefaults,
    ) -> SystemAppearanceModePayload {
        if workspace.accessibilityDisplayShouldIncreaseContrast() {
            return SystemAppearanceModePayload::HighContrast;
        }

        let Some(style) = defaults.stringForKey(ns_string!("AppleInterfaceStyle")) else {
            return SystemAppearanceModePayload::Light;
        };
        if style.isEqualToString(ns_string!("Dark")) {
            return SystemAppearanceModePayload::Dark;
        }

        SystemAppearanceModePayload::Light
    }

    fn accent_color() -> Option<SystemAppearanceColorPayload> {
        let color = NSColor::controlAccentColor();
        let component_color = color.colorUsingType(NSColorType::ComponentBased)?;
        Some(SystemAppearanceColorPayload::new(
            component_color.redComponent(),
            component_color.greenComponent(),
            component_color.blueComponent(),
            component_color.alphaComponent(),
        ))
    }
}

#[cfg(all(any(target_os = "macos", target_os = "windows"), not(test)))]
mod platform_events {
    use super::{
        send_snapshot_event, snapshot, HostProtocolEnvelope, HostProtocolError,
        SystemAppearanceSnapshot,
    };
    use std::{
        sync::{
            mpsc::{self, Sender},
            LazyLock, Mutex,
        },
        thread::{self, JoinHandle},
        time::Duration,
    };

    static SYSTEM_APPEARANCE_EVENTS: LazyLock<Mutex<Option<SystemAppearanceEventState>>> =
        LazyLock::new(|| Mutex::new(None));

    struct SystemAppearanceEventState {
        poller: SnapshotPoller,
    }

    struct SnapshotPoller {
        stop: Sender<()>,
        handle: JoinHandle<()>,
    }

    pub(crate) fn install_runtime_event_sender(
        sender: Sender<HostProtocolEnvelope>,
    ) -> Result<(), HostProtocolError> {
        clear_runtime_event_sender()?;
        *SYSTEM_APPEARANCE_EVENTS.lock().map_err(|_| {
            HostProtocolError::internal(
                "system appearance event state lock poisoned",
                host_protocol::SYSTEM_APPEARANCE_APPEARANCE_CHANGED_EVENT,
            )
        })? = Some(SystemAppearanceEventState {
            poller: start_snapshot_poller(sender),
        });
        Ok(())
    }

    pub(crate) fn clear_runtime_event_sender() -> Result<(), HostProtocolError> {
        let Some(state) = SYSTEM_APPEARANCE_EVENTS
            .lock()
            .map_err(|_| {
                HostProtocolError::internal(
                    "system appearance event state lock poisoned",
                    host_protocol::SYSTEM_APPEARANCE_APPEARANCE_CHANGED_EVENT,
                )
            })?
            .take()
        else {
            return Ok(());
        };

        let _ = state.poller.stop.send(());
        let _ = state.poller.handle.join();
        Ok(())
    }

    fn start_snapshot_poller(sender: Sender<HostProtocolEnvelope>) -> SnapshotPoller {
        let (stop, stop_rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let mut last_snapshot = None;
            emit_if_changed(&sender, &mut last_snapshot);
            loop {
                if stop_rx.recv_timeout(Duration::from_secs(2)).is_ok() {
                    break;
                }
                emit_if_changed(&sender, &mut last_snapshot);
            }
        });
        SnapshotPoller { stop, handle }
    }

    fn emit_if_changed(
        sender: &Sender<HostProtocolEnvelope>,
        last_snapshot: &mut Option<SystemAppearanceSnapshot>,
    ) {
        match snapshot(host_protocol::SYSTEM_APPEARANCE_APPEARANCE_CHANGED_EVENT) {
            Ok(next_snapshot) if last_snapshot.as_ref() != Some(&next_snapshot) => {
                *last_snapshot = Some(next_snapshot.clone());
                send_snapshot_event(sender, next_snapshot);
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(error = ?error, "failed to poll system appearance snapshot");
            }
        }
    }
}

#[cfg(not(all(any(target_os = "macos", target_os = "windows"), not(test))))]
mod platform_events {
    use super::{HostProtocolEnvelope, HostProtocolError};
    use std::sync::mpsc::Sender;

    pub(crate) fn install_runtime_event_sender(
        _sender: Sender<HostProtocolEnvelope>,
    ) -> Result<(), HostProtocolError> {
        Ok(())
    }

    pub(crate) fn clear_runtime_event_sender() -> Result<(), HostProtocolError> {
        Ok(())
    }
}

#[cfg(all(target_os = "windows", not(test)))]
mod windows_system_appearance {
    use super::{windows_colorization_color, HostProtocolError, SystemAppearanceSnapshot};
    use host_protocol::SystemAppearanceModePayload;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
        UI::{
            Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW},
            WindowsAndMessaging::{
                SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SPI_GETHIGHCONTRAST,
            },
        },
    };

    const PERSONALIZE_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    const DWM_KEY: &str = r"Software\Microsoft\Windows\DWM";

    pub(super) fn snapshot(
        operation: &'static str,
    ) -> Result<SystemAppearanceSnapshot, HostProtocolError> {
        let high_contrast = high_contrast_enabled(operation)?;
        let apps_use_light_theme =
            read_current_user_dword(PERSONALIZE_KEY, "AppsUseLightTheme", operation)?;
        let enable_transparency =
            read_current_user_dword(PERSONALIZE_KEY, "EnableTransparency", operation)?;
        let colorization_color = read_current_user_dword(DWM_KEY, "ColorizationColor", operation)?;

        Ok(SystemAppearanceSnapshot {
            appearance: if high_contrast {
                SystemAppearanceModePayload::HighContrast
            } else if apps_use_light_theme == Some(0) {
                SystemAppearanceModePayload::Dark
            } else {
                SystemAppearanceModePayload::Light
            },
            accent_color: colorization_color.map(windows_colorization_color),
            reduced_motion: !client_area_animation_enabled(operation)?,
            reduced_transparency: enable_transparency == Some(0),
        })
    }

    fn high_contrast_enabled(operation: &'static str) -> Result<bool, HostProtocolError> {
        let mut contrast = HIGHCONTRASTW {
            cbSize: std::mem::size_of::<HIGHCONTRASTW>() as u32,
            ..Default::default()
        };
        let result = unsafe {
            SystemParametersInfoW(
                SPI_GETHIGHCONTRAST,
                contrast.cbSize,
                (&mut contrast as *mut HIGHCONTRASTW).cast(),
                0,
            )
        };
        if result == 0 {
            return Err(last_os_error(
                "SystemParametersInfoW(SPI_GETHIGHCONTRAST)",
                operation,
            ));
        }
        Ok(contrast.dwFlags & HCF_HIGHCONTRASTON != 0)
    }

    fn client_area_animation_enabled(operation: &'static str) -> Result<bool, HostProtocolError> {
        let mut enabled = 0;
        let result = unsafe {
            SystemParametersInfoW(
                SPI_GETCLIENTAREAANIMATION,
                0,
                (&mut enabled as *mut i32).cast(),
                0,
            )
        };
        if result == 0 {
            return Err(last_os_error(
                "SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION)",
                operation,
            ));
        }
        Ok(enabled != 0)
    }

    fn read_current_user_dword(
        key: &str,
        value_name: &str,
        operation: &'static str,
    ) -> Result<Option<u32>, HostProtocolError> {
        let key_name = key;
        let value_name_str = value_name;
        let key = wide_null(key_name);
        let value_name = wide_null(value_name_str);
        let mut value = 0_u32;
        let mut value_type = 0_u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                value_name.as_ptr(),
                RRF_RT_REG_DWORD,
                &mut value_type,
                (&mut value as *mut u32).cast(),
                &mut size,
            )
        };

        match status {
            ERROR_SUCCESS => Ok(Some(value)),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(None),
            error => Err(HostProtocolError::internal(
                format!("RegGetValueW failed for {key_name}/{value_name_str}: error {error}"),
                operation,
            )),
        }
    }

    fn wide_null(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain([0]).collect()
    }

    fn last_os_error(operation_name: &'static str, operation: &'static str) -> HostProtocolError {
        HostProtocolError::internal(
            format!(
                "{operation_name} failed: {}",
                std::io::Error::last_os_error()
            ),
            operation,
        )
    }
}

#[cfg(any(test, target_os = "windows"))]
fn windows_colorization_color(value: u32) -> SystemAppearanceColorPayload {
    let alpha = f64::from((value >> 24) & 0xff) / WINDOWS_COLOR_CHANNEL_MAX;
    let red = f64::from((value >> 16) & 0xff) / WINDOWS_COLOR_CHANNEL_MAX;
    let green = f64::from((value >> 8) & 0xff) / WINDOWS_COLOR_CHANNEL_MAX;
    let blue = f64::from(value & 0xff) / WINDOWS_COLOR_CHANNEL_MAX;
    SystemAppearanceColorPayload::new(red, green, blue, alpha)
}

#[cfg(test)]
mod tests {
    use super::{
        get_accent_color, get_appearance, get_reduced_motion, get_reduced_transparency,
        is_supported, send_snapshot_event, windows_colorization_color, SystemAppearanceSnapshot,
        TEST_SYSTEM_APPEARANCE,
    };
    use host_protocol::{
        HostProtocolEnvelope, HostProtocolError, SystemAppearanceColorPayload,
        SystemAppearanceIsSupportedPayload, SystemAppearanceMethodPayload,
        SystemAppearanceModePayload,
    };
    use serde_json::{json, Value};

    #[test]
    fn system_appearance_reads_decode_before_unsupported() {
        assert_eq!(
            get_appearance(None).expect_err("appearance"),
            HostProtocolError::unsupported(
                host_protocol::SYSTEM_APPEARANCE_UNSUPPORTED_REASON,
                host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
            )
        );
        assert_eq!(
            get_reduced_motion(None).expect_err("reduced motion"),
            HostProtocolError::unsupported(
                host_protocol::SYSTEM_APPEARANCE_UNSUPPORTED_REASON,
                host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_MOTION_METHOD,
            )
        );
    }

    #[test]
    fn system_appearance_rejects_unexpected_payload_before_unsupported() {
        assert_eq!(
            get_appearance(Some(json!({}))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
            )
        );
        assert_eq!(
            get_appearance(Some(Value::Null)).expect_err("null payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
            )
        );
    }

    #[test]
    fn system_appearance_reads_snapshot_values() {
        TEST_SYSTEM_APPEARANCE.with(|state| {
            *state.borrow_mut() = Some(SystemAppearanceSnapshot {
                appearance: SystemAppearanceModePayload::Dark,
                accent_color: Some(SystemAppearanceColorPayload::new(0.1, 0.2, 0.3, 1.0)),
                reduced_motion: true,
                reduced_transparency: false,
            });
        });

        assert_eq!(
            get_appearance(None).expect("appearance"),
            Some(json!({ "appearance": "dark" }))
        );
        assert_eq!(
            get_accent_color(None).expect("accent color"),
            Some(json!({ "color": { "r": 0.1, "g": 0.2, "b": 0.3, "a": 1.0 } }))
        );
        assert_eq!(
            get_reduced_motion(None).expect("reduced motion"),
            Some(json!({ "enabled": true }))
        );
        assert_eq!(
            get_reduced_transparency(None).expect("reduced transparency"),
            Some(json!({ "enabled": false }))
        );

        TEST_SYSTEM_APPEARANCE.with(|state| {
            *state.borrow_mut() = None;
        });
    }

    #[test]
    fn system_appearance_support_reports_false_for_known_methods() {
        let payload = is_supported(Some(json!({ "method": "getAppearance" })))
            .expect("support query should return payload");
        assert_eq!(payload, Some(json!({ "supported": false })));
    }

    #[test]
    fn system_appearance_support_reports_snapshot_test_adapter() {
        TEST_SYSTEM_APPEARANCE.with(|state| {
            *state.borrow_mut() = Some(SystemAppearanceSnapshot {
                appearance: SystemAppearanceModePayload::Light,
                accent_color: None,
                reduced_motion: false,
                reduced_transparency: false,
            });
        });

        for method in [
            SystemAppearanceMethodPayload::GetAppearance,
            SystemAppearanceMethodPayload::GetAccentColor,
            SystemAppearanceMethodPayload::GetReducedMotion,
            SystemAppearanceMethodPayload::GetReducedTransparency,
            SystemAppearanceMethodPayload::OnAppearanceChanged,
        ] {
            let payload = is_supported(Some(
                serde_json::to_value(SystemAppearanceIsSupportedPayload::new(method))
                    .expect("support query should encode"),
            ))
            .expect("support query should return payload");
            assert_eq!(payload, Some(json!({ "supported": true })));
        }

        TEST_SYSTEM_APPEARANCE.with(|state| {
            *state.borrow_mut() = None;
        });
    }

    #[test]
    fn system_appearance_event_payload_matches_snapshot_shape() {
        let (sender, receiver) = std::sync::mpsc::channel::<HostProtocolEnvelope>();
        send_snapshot_event(
            &sender,
            SystemAppearanceSnapshot {
                appearance: SystemAppearanceModePayload::HighContrast,
                accent_color: Some(SystemAppearanceColorPayload::new(0.4, 0.5, 0.6, 1.0)),
                reduced_motion: true,
                reduced_transparency: false,
            },
        );

        let event = receiver.recv().expect("system appearance event");
        let HostProtocolEnvelope::Event {
            method,
            payload: Some(payload),
            ..
        } = event
        else {
            panic!("expected system appearance event");
        };
        assert_eq!(
            method,
            host_protocol::SYSTEM_APPEARANCE_APPEARANCE_CHANGED_EVENT
        );
        assert_eq!(
            payload,
            json!({
                "appearance": "highContrast",
                "accentColor": { "r": 0.4, "g": 0.5, "b": 0.6, "a": 1.0 },
                "reducedMotion": true,
                "reducedTransparency": false
            })
        );
    }

    #[test]
    fn system_appearance_support_rejects_unknown_methods() {
        let error = is_supported(Some(json!({ "method": "theme" })))
            .expect_err("unknown method should reject");
        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn system_appearance_converts_windows_colorization_color() {
        let color = windows_colorization_color(0x8040_80ff);

        assert_eq!(
            serde_json::to_value(color).expect("color should encode"),
            json!({
                "r": 64.0 / 255.0,
                "g": 128.0 / 255.0,
                "b": 1.0,
                "a": 128.0 / 255.0
            })
        );
    }
}

#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, SystemAppearanceAccentColorPayload, SystemAppearanceBooleanPayload,
    SystemAppearanceColorPayload, SystemAppearanceIsSupportedPayload,
    SystemAppearanceMethodPayload, SystemAppearanceModePayload, SystemAppearanceResultPayload,
    SystemAppearanceSupportedPayload,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{to_value, Value};
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

#[cfg(any(test, not(target_os = "macos")))]
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
        SystemAppearanceMethodPayload::OnAppearanceChanged => false,
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
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSAppearance, NSAppearanceNameAccessibilityHighContrastAqua,
        NSAppearanceNameAccessibilityHighContrastDarkAqua,
        NSAppearanceNameAccessibilityHighContrastVibrantDark,
        NSAppearanceNameAccessibilityHighContrastVibrantLight, NSAppearanceNameDarkAqua,
        NSApplication, NSColor, NSColorType, NSWorkspace,
    };
    use objc2_foundation::NSArray;

    pub(super) fn snapshot(
        operation: &'static str,
    ) -> Result<SystemAppearanceSnapshot, HostProtocolError> {
        let Some(marker) = MainThreadMarker::new() else {
            return Err(HostProtocolError::internal(
                "macOS system appearance must run on the main thread",
                operation,
            ));
        };

        let application = NSApplication::sharedApplication(marker);
        let appearance = application.effectiveAppearance();
        let workspace = NSWorkspace::sharedWorkspace();

        Ok(SystemAppearanceSnapshot {
            appearance: appearance_mode(&appearance),
            accent_color: accent_color(),
            reduced_motion: workspace.accessibilityDisplayShouldReduceMotion(),
            reduced_transparency: workspace.accessibilityDisplayShouldReduceTransparency(),
        })
    }

    fn appearance_mode(appearance: &NSAppearance) -> SystemAppearanceModePayload {
        let high_contrast_aqua = unsafe { NSAppearanceNameAccessibilityHighContrastAqua };
        let high_contrast_dark = unsafe { NSAppearanceNameAccessibilityHighContrastDarkAqua };
        let high_contrast_vibrant_light =
            unsafe { NSAppearanceNameAccessibilityHighContrastVibrantLight };
        let high_contrast_vibrant_dark =
            unsafe { NSAppearanceNameAccessibilityHighContrastVibrantDark };
        let dark = unsafe { NSAppearanceNameDarkAqua };
        let names = NSArray::from_slice(&[
            high_contrast_aqua,
            high_contrast_dark,
            high_contrast_vibrant_light,
            high_contrast_vibrant_dark,
            dark,
        ]);

        let Some(best_match) = appearance.bestMatchFromAppearancesWithNames(&names) else {
            return SystemAppearanceModePayload::Light;
        };

        if best_match.isEqualToString(high_contrast_aqua)
            || best_match.isEqualToString(high_contrast_dark)
            || best_match.isEqualToString(high_contrast_vibrant_light)
            || best_match.isEqualToString(high_contrast_vibrant_dark)
        {
            return SystemAppearanceModePayload::HighContrast;
        }

        if best_match.isEqualToString(dark) {
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
        is_supported, windows_colorization_color, SystemAppearanceSnapshot, TEST_SYSTEM_APPEARANCE,
    };
    use host_protocol::{
        HostProtocolError, SystemAppearanceColorPayload, SystemAppearanceIsSupportedPayload,
        SystemAppearanceMethodPayload, SystemAppearanceModePayload,
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
        ] {
            let payload = is_supported(Some(
                serde_json::to_value(SystemAppearanceIsSupportedPayload::new(method))
                    .expect("support query should encode"),
            ))
            .expect("support query should return payload");
            assert_eq!(payload, Some(json!({ "supported": true })));
        }

        let events = is_supported(Some(json!({ "method": "onAppearanceChanged" })))
            .expect("events support should return payload");
        assert_eq!(events, Some(json!({ "supported": false })));

        TEST_SYSTEM_APPEARANCE.with(|state| {
            *state.borrow_mut() = None;
        });
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

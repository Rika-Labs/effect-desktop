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

#[cfg(all(target_os = "macos", not(test)))]
fn has_host_snapshot() -> bool {
    true
}

#[cfg(not(all(target_os = "macos", not(test))))]
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

    #[cfg(not(all(target_os = "macos", not(test))))]
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

#[cfg(test)]
mod tests {
    use super::{
        get_accent_color, get_appearance, get_reduced_motion, get_reduced_transparency,
        is_supported, SystemAppearanceSnapshot, TEST_SYSTEM_APPEARANCE,
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
}

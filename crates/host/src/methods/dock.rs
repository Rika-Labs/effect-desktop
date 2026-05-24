#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::HostProtocolError;
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DockMethod {
    SetBadgeCount,
    SetBadgeText,
    SetProgress,
    SetMenu,
    SetJumpList,
    RequestAttention,
}

pub(crate) fn set_badge_count(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let count = decode_count(payload)?;
    let label = if count == 0 {
        None
    } else {
        Some(count.to_string())
    };
    handler.set_dock_badge_label(label, host_protocol::DOCK_SET_BADGE_COUNT_METHOD)?;

    Ok(None)
}

pub(crate) fn set_badge_text(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let text = decode_text(payload)?;
    handler.set_dock_badge_label(text, host_protocol::DOCK_SET_BADGE_TEXT_METHOD)?;

    Ok(None)
}

pub(crate) fn set_progress(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_progress(payload)?;
    validate_progress_value(payload.value())?;

    handler.set_dock_progress(&payload)?;

    Ok(None)
}

pub(crate) fn request_attention(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let critical = decode_critical(payload)?;
    handler.request_dock_attention(critical)?;

    Ok(None)
}

pub(crate) fn is_supported(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let method = decode_supported_method(payload)?;
    Ok(Some(json!({ "supported": dock_method_supported(method) })))
}

fn decode_progress(
    payload: Option<Value>,
) -> Result<host_protocol::DockSetProgressPayload, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::DOCK_SET_PROGRESS_METHOD)?;
    serde_json::from_value::<host_protocol::DockSetProgressPayload>(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::DOCK_SET_PROGRESS_METHOD,
        )
    })
}

fn validate_progress_value(value: &Value) -> Result<(), HostProtocolError> {
    match value {
        Value::Null => Ok(()),
        Value::Number(number) => {
            let Some(progress) = number.as_f64() else {
                return Err(HostProtocolError::invalid_argument(
                    "value",
                    "must be null or a finite number between 0 and 1",
                    host_protocol::DOCK_SET_PROGRESS_METHOD,
                ));
            };
            if !progress.is_finite() || !(0.0..=1.0).contains(&progress) {
                return Err(HostProtocolError::invalid_argument(
                    "value",
                    "must be null or a finite number between 0 and 1",
                    host_protocol::DOCK_SET_PROGRESS_METHOD,
                ));
            }
            Ok(())
        }
        _ => Err(HostProtocolError::invalid_argument(
            "value",
            "must be null or a finite number between 0 and 1",
            host_protocol::DOCK_SET_PROGRESS_METHOD,
        )),
    }
}

fn decode_count(payload: Option<Value>) -> Result<u64, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::DOCK_SET_BADGE_COUNT_METHOD)?;
    let Some(count) = payload.get("count").and_then(Value::as_f64) else {
        return Err(HostProtocolError::invalid_argument(
            "count",
            "must be a number",
            host_protocol::DOCK_SET_BADGE_COUNT_METHOD,
        ));
    };
    if !count.is_finite() || count < 0.0 || count.fract() != 0.0 {
        return Err(HostProtocolError::invalid_argument(
            "count",
            "must be a finite non-negative integer",
            host_protocol::DOCK_SET_BADGE_COUNT_METHOD,
        ));
    }

    Ok(count as u64)
}

fn decode_text(payload: Option<Value>) -> Result<Option<String>, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::DOCK_SET_BADGE_TEXT_METHOD)?;
    match payload.get("text") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => {
            if text.is_empty() {
                return Err(HostProtocolError::invalid_argument(
                    "text",
                    "must not be empty",
                    host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
                ));
            }
            if has_ascii_control_characters(text) {
                return Err(HostProtocolError::invalid_argument(
                    "text",
                    "must not include control characters",
                    host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
                ));
            }
            Ok(Some(text.clone()))
        }
        Some(_) => Err(HostProtocolError::invalid_argument(
            "text",
            "must be a string or null",
            host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
        )),
        None => Err(HostProtocolError::invalid_argument(
            "text",
            "is required",
            host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
        )),
    }
}

fn has_ascii_control_characters(text: &str) -> bool {
    text.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f))
}

fn decode_critical(payload: Option<Value>) -> Result<bool, HostProtocolError> {
    match payload {
        None => Ok(false),
        Some(payload) => match payload.get("critical") {
            None => Ok(false),
            Some(Value::Bool(critical)) => Ok(*critical),
            Some(_) => Err(HostProtocolError::invalid_argument(
                "critical",
                "must be a boolean",
                host_protocol::DOCK_REQUEST_ATTENTION_METHOD,
            )),
        },
    }
}

fn decode_supported_method(payload: Option<Value>) -> Result<DockMethod, HostProtocolError> {
    let Some(payload) = payload else {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "is required",
            host_protocol::DOCK_IS_SUPPORTED_METHOD,
        ));
    };
    match payload.get("method") {
        Some(Value::String(method)) => parse_dock_method(method),
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

#[cfg(target_os = "macos")]
fn dock_method_supported(method: DockMethod) -> bool {
    matches!(
        method,
        DockMethod::SetBadgeCount
            | DockMethod::SetBadgeText
            | DockMethod::SetProgress
            | DockMethod::RequestAttention
    )
}

#[cfg(target_os = "windows")]
fn dock_method_supported(method: DockMethod) -> bool {
    matches!(method, DockMethod::RequestAttention)
}

#[cfg(target_os = "linux")]
fn dock_method_supported(method: DockMethod) -> bool {
    matches!(method, DockMethod::RequestAttention)
}

fn required_payload(payload: Option<Value>, operation: &str) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

#[cfg(test)]
mod tests {
    use super::{
        decode_count, decode_critical, decode_progress, decode_supported_method, decode_text,
        dock_method_supported, validate_progress_value, DockMethod,
    };
    use serde_json::json;

    #[test]
    fn count_zero_clears_badge() {
        assert_eq!(decode_count(Some(json!({ "count": 0 }))).expect("count"), 0);
    }

    #[test]
    fn count_rejects_fractional_values() {
        assert!(decode_count(Some(json!({ "count": 1.5 }))).is_err());
    }

    #[test]
    fn text_accepts_null_clear() {
        assert_eq!(
            decode_text(Some(json!({ "text": null }))).expect("text"),
            None
        );
    }

    #[test]
    fn text_rejects_empty_string() {
        assert!(decode_text(Some(json!({ "text": "" }))).is_err());
    }

    #[test]
    fn text_rejects_missing_field() {
        assert!(decode_text(Some(json!({}))).is_err());
    }

    #[test]
    fn text_rejects_ascii_control_characters() {
        assert!(decode_text(Some(json!({ "text": "bad\u{0000}text" }))).is_err());
        assert!(decode_text(Some(json!({ "text": "line\nbreak" }))).is_err());
        assert!(decode_text(Some(json!({ "text": "badge\ttext" }))).is_err());
    }

    #[test]
    fn critical_defaults_to_false() {
        assert!(!decode_critical(None).expect("critical"));
        assert!(!decode_critical(Some(json!({}))).expect("critical"));
    }

    #[test]
    fn critical_rejects_non_boolean_values() {
        assert!(decode_critical(Some(json!({ "critical": "yes" }))).is_err());
    }

    #[test]
    fn support_matches_current_platform_rows() {
        #[cfg(target_os = "macos")]
        {
            assert!(dock_method_supported(DockMethod::SetBadgeCount));
            assert!(dock_method_supported(DockMethod::SetBadgeText));
            assert!(dock_method_supported(DockMethod::SetProgress));
            assert!(dock_method_supported(DockMethod::RequestAttention));
            assert!(!dock_method_supported(DockMethod::SetMenu));
            assert!(!dock_method_supported(DockMethod::SetJumpList));
        }

        #[cfg(target_os = "windows")]
        {
            assert!(dock_method_supported(DockMethod::RequestAttention));
            assert!(!dock_method_supported(DockMethod::SetBadgeCount));
            assert!(!dock_method_supported(DockMethod::SetBadgeText));
            assert!(!dock_method_supported(DockMethod::SetProgress));
            assert!(!dock_method_supported(DockMethod::SetMenu));
            assert!(!dock_method_supported(DockMethod::SetJumpList));
        }

        #[cfg(target_os = "linux")]
        {
            assert!(dock_method_supported(DockMethod::RequestAttention));
            assert!(!dock_method_supported(DockMethod::SetBadgeCount));
            assert!(!dock_method_supported(DockMethod::SetBadgeText));
            assert!(!dock_method_supported(DockMethod::SetProgress));
            assert!(!dock_method_supported(DockMethod::SetMenu));
            assert!(!dock_method_supported(DockMethod::SetJumpList));
        }
    }

    #[test]
    fn support_rejects_blank_and_unknown_methods() {
        assert!(decode_supported_method(Some(json!({ "method": "" }))).is_err());
        assert!(decode_supported_method(Some(json!({ "method": "missing" }))).is_err());
        assert_eq!(
            decode_supported_method(Some(json!({ "method": "setBadgeCount" }))).expect("method"),
            DockMethod::SetBadgeCount
        );
    }

    #[test]
    fn progress_accepts_null_and_fractional_values() {
        let clear = decode_progress(Some(json!({ "value": null }))).expect("clear progress");
        validate_progress_value(clear.value()).expect("clear progress should validate");

        let progress = decode_progress(Some(json!({
            "value": 0.5,
            "options": { "state": "normal" }
        })))
        .expect("fractional progress");
        validate_progress_value(progress.value()).expect("fractional progress should validate");
    }

    #[test]
    fn progress_rejects_invalid_shape_before_side_effects() {
        assert!(decode_progress(Some(json!({}))).is_err());
        assert!(decode_progress(Some(json!({ "value": 0.5, "extra": true }))).is_err());
        assert!(decode_progress(Some(json!({
            "value": 0.5,
            "options": { "state": "bogus" }
        })))
        .is_err());
        assert!(validate_progress_value(&json!(-0.1)).is_err());
        assert!(validate_progress_value(&json!(1.1)).is_err());
        assert!(validate_progress_value(&json!("0.5")).is_err());
    }
}

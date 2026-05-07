#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

#[cfg(target_os = "linux")]
use crate::linux;
use crate::window::WindowMethodHandler;
use host_protocol::HostProtocolError;
use serde_json::Value;

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
    #[cfg(target_os = "linux")]
    {
        let _ = handler;
        let _ = payload;
        return Err(linux::unsupported_linux_dock_method(
            host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
        ));
    }

    #[cfg(not(target_os = "linux"))]
    {
        let text = decode_text(payload)?;
        handler.set_dock_badge_label(text, host_protocol::DOCK_SET_BADGE_TEXT_METHOD)?;

        Ok(None)
    }
}

pub(crate) fn request_attention(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let critical = decode_critical(payload)?;
    handler.request_dock_attention(critical)?;

    Ok(None)
}

pub(crate) fn set_menu(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    #[cfg(target_os = "linux")]
    {
        let _ = handler;
        let _ = payload;
        return Err(linux::unsupported_linux_dock_method(
            host_protocol::DOCK_SET_MENU_METHOD,
        ));
    }

    #[cfg(not(target_os = "linux"))]
    {
        let menu = decode_menu(payload)?;
        handler.set_dock_menu(menu)?;

        Ok(None)
    }
}

fn decode_menu(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::DOCK_SET_MENU_METHOD)?;
    match payload.get("menu") {
        Some(Value::Null) => Ok(None),
        Some(menu) => {
            validate_template(menu)?;
            Ok(Some(menu.clone()))
        }
        None => Err(HostProtocolError::invalid_argument(
            "menu",
            "is required",
            host_protocol::DOCK_SET_MENU_METHOD,
        )),
    }
}

fn validate_template(template: &Value) -> Result<(), HostProtocolError> {
    let Some(items) = template.get("items").and_then(Value::as_array) else {
        return Err(HostProtocolError::invalid_argument(
            "menu.items",
            "must be an array",
            host_protocol::DOCK_SET_MENU_METHOD,
        ));
    };
    if items.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "menu.items",
            "must not be empty",
            host_protocol::DOCK_SET_MENU_METHOD,
        ));
    }
    Ok(())
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
        Some(Value::String(text)) => Ok(Some(text.clone())),
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

fn required_payload(payload: Option<Value>, operation: &str) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

#[cfg(test)]
mod tests {
    use super::{decode_count, decode_critical, decode_menu, decode_text};
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
    fn text_rejects_missing_field() {
        assert!(decode_text(Some(json!({}))).is_err());
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

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn dock_menu_accepts_null_clear() {
        assert_eq!(
            decode_menu(Some(json!({ "menu": null }))).expect("menu"),
            None
        );
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn dock_menu_requires_items() {
        assert!(decode_menu(Some(json!({ "menu": { "items": [] } }))).is_err());
    }
}

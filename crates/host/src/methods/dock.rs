#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

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
    handler.set_dock_badge_label(label)?;

    Ok(None)
}

pub(crate) fn set_badge_text(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let text = decode_text(payload)?;
    handler.set_dock_badge_label(text)?;

    Ok(None)
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

fn required_payload(payload: Option<Value>, operation: &str) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

#[cfg(test)]
mod tests {
    use super::{decode_count, decode_text};
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
}

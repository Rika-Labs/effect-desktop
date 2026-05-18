#![allow(clippy::result_large_err)]

use host_protocol::{
    DisplayCaptureActorPayload, DisplayCaptureRequestPayload, DisplayCaptureSource,
    DisplayCaptureSupportedPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn capture_display(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DisplayCaptureRequestPayload>(
        payload,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
    )?;
    validate_request(
        &input,
        DisplayCaptureSource::Display,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
    )?;
    Err(unsupported(
        host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
    ))
}

pub(crate) fn capture_window(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DisplayCaptureRequestPayload>(
        payload,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD,
    )?;
    validate_request(
        &input,
        DisplayCaptureSource::Window,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD,
    )?;
    Err(unsupported(
        host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD,
    ))
}

pub(crate) fn capture_region(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DisplayCaptureRequestPayload>(
        payload,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD,
    )?;
    validate_request(
        &input,
        DisplayCaptureSource::Region,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD,
    )?;
    Err(unsupported(
        host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        DisplayCaptureSupportedPayload::unsupported(
            host_protocol::DISPLAY_CAPTURE_UNSUPPORTED_REASON,
        ),
        host_protocol::DISPLAY_CAPTURE_IS_SUPPORTED_METHOD,
    )
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
            format!("failed to encode display capture payload: {error}"),
            operation,
        )
    })
}

fn validate_request(
    input: &DisplayCaptureRequestPayload,
    source: DisplayCaptureSource,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_non_empty("grant.id", input.grant().id(), operation)?;
    if let Some(reason) = input.grant().reason() {
        validate_non_empty("grant.reason", reason, operation)?;
    }
    validate_trace_id(input.trace_id(), operation)?;
    validate_target(input, source, operation)
}

fn validate_actor(
    actor: &DisplayCaptureActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_target(
    input: &DisplayCaptureRequestPayload,
    source: DisplayCaptureSource,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let target = input.target();
    if target.source() != source {
        return Err(HostProtocolError::invalid_argument(
            "target.source",
            "must match capture method",
            operation,
        ));
    }

    match source {
        DisplayCaptureSource::Display => {
            validate_required("target.displayId", target.display_id(), operation)?;
            reject_present("target.windowId", target.window_id(), operation)?;
            reject_region(target.region_payload(), operation)
        }
        DisplayCaptureSource::Window => {
            validate_required("target.windowId", target.window_id(), operation)?;
            reject_present("target.displayId", target.display_id(), operation)?;
            reject_region(target.region_payload(), operation)
        }
        DisplayCaptureSource::Region => {
            validate_required("target.displayId", target.display_id(), operation)?;
            reject_present("target.windowId", target.window_id(), operation)?;
            let region = target.region_payload().ok_or_else(|| {
                HostProtocolError::invalid_argument("target.region", "is required", operation)
            })?;
            validate_region(region.values(), operation)
        }
    }
}

fn validate_required(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let value = value
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "is required", operation))?;
    validate_non_empty(field, value, operation)
}

fn reject_present(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_some() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be present for this capture source",
            operation,
        ));
    }
    Ok(())
}

fn reject_region(
    value: Option<&host_protocol::DisplayCaptureRegionPayload>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_some() {
        return Err(HostProtocolError::invalid_argument(
            "target.region",
            "must not be present for this capture source",
            operation,
        ));
    }
    Ok(())
}

fn validate_region(
    (_x, _y, width, height): (f64, f64, f64, f64),
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(HostProtocolError::invalid_argument(
            "target.region",
            "width and height must be finite positive numbers",
            operation,
        ));
    }
    Ok(())
}

fn validate_trace_id(
    trace_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(trace_id) = trace_id {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_no_nul(field, value, operation)?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_printable_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_no_nul(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::DISPLAY_CAPTURE_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn capture_display_validates_before_returning_unsupported() {
        let error =
            capture_display(Some(display_request())).expect_err("host adapter is not implemented");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn capture_window_rejects_wrong_source_before_unsupported() {
        let invalid = display_request();

        let error = capture_window(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn capture_region_rejects_non_positive_region_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": {
                "source": "region",
                "displayId": "display-1",
                "region": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 10.0 }
            }
        });

        let error = capture_region(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn capture_display_rejects_control_byte_actor_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace\n1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": { "source": "display", "displayId": "display-1" }
        });

        let error = capture_display(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn is_supported_reports_unimplemented_adapter() {
        let payload = is_supported()
            .expect("support response should encode")
            .expect("support response should include payload");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::DISPLAY_CAPTURE_UNSUPPORTED_REASON
            })
        );
    }

    fn display_request() -> serde_json::Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": { "source": "display", "displayId": "display-1" },
            "traceId": "trace-display-capture"
        })
    }
}

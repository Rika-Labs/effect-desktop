#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{BrowsingDataSupportedPayload, HostProtocolError};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-browsing-data-unavailable";
const DATA_TYPES: &[&str] = &[
    "cache",
    "cookies",
    "localStorage",
    "indexedDb",
    "history",
    "serviceWorkers",
];

pub(crate) fn clear(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::BROWSING_DATA_CLEAR_METHOD)?;
    validate_profile_handle(&payload, host_protocol::BROWSING_DATA_CLEAR_METHOD)?;
    validate_types(&payload, true, host_protocol::BROWSING_DATA_CLEAR_METHOD)?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::BROWSING_DATA_CLEAR_METHOD,
    )?;
    Err(unsupported(host_protocol::BROWSING_DATA_CLEAR_METHOD))
}

pub(crate) fn estimate(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::BROWSING_DATA_ESTIMATE_METHOD)?;
    validate_profile_handle(&payload, host_protocol::BROWSING_DATA_ESTIMATE_METHOD)?;
    validate_types(
        &payload,
        false,
        host_protocol::BROWSING_DATA_ESTIMATE_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::BROWSING_DATA_ESTIMATE_METHOD,
    )?;
    Err(unsupported(host_protocol::BROWSING_DATA_ESTIMATE_METHOD))
}

pub(crate) fn list_types(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    validate_empty_payload(payload, host_protocol::BROWSING_DATA_LIST_TYPES_METHOD)?;
    Err(unsupported(host_protocol::BROWSING_DATA_LIST_TYPES_METHOD))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(BrowsingDataSupportedPayload::unsupported(
        UNSUPPORTED_REASON,
    ))
    .map(Some)
    .map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode browsing data support: {error}"),
            host_protocol::BROWSING_DATA_IS_SUPPORTED_METHOD,
        )
    })
}

fn require_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

fn validate_empty_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(payload) = payload {
        let Some(object) = payload.as_object() else {
            return Err(HostProtocolError::invalid_argument(
                "payload",
                "must be an object",
                operation,
            ));
        };
        if !object.is_empty() {
            return Err(HostProtocolError::invalid_argument(
                "payload",
                "must be empty",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_profile_handle(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let profile = payload
        .get("profile")
        .ok_or_else(|| HostProtocolError::invalid_argument("profile", "is required", operation))?;
    let Some(profile) = profile.as_object() else {
        return Err(HostProtocolError::invalid_argument(
            "profile",
            "must be an object",
            operation,
        ));
    };
    if profile.get("kind").and_then(Value::as_str) != Some("session-profile") {
        return Err(HostProtocolError::invalid_argument(
            "profile.kind",
            "must be session-profile",
            operation,
        ));
    }
    validate_object_string(profile.get("id"), "profile.id", operation)?;
    validate_object_string(profile.get("ownerScope"), "profile.ownerScope", operation)?;
    validate_object_string(profile.get("state"), "profile.state", operation)?;
    if profile.get("state").and_then(Value::as_str) != Some("open") {
        return Err(HostProtocolError::invalid_argument(
            "profile.state",
            "must be open",
            operation,
        ));
    }
    if !profile.get("generation").is_some_and(Value::is_u64) {
        return Err(HostProtocolError::invalid_argument(
            "profile.generation",
            "must be an unsigned integer",
            operation,
        ));
    }
    Ok(())
}

fn validate_types(
    payload: &Value,
    required: bool,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(types) = payload.get("types") else {
        return if required {
            Err(HostProtocolError::invalid_argument(
                "types",
                "is required",
                operation,
            ))
        } else {
            Ok(())
        };
    };
    let Some(types) = types.as_array() else {
        return Err(HostProtocolError::invalid_argument(
            "types",
            "must be an array",
            operation,
        ));
    };
    if types.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "types",
            "must be non-empty",
            operation,
        ));
    }
    for (index, value) in types.iter().enumerate() {
        let Some(data_type) = value.as_str() else {
            return Err(HostProtocolError::invalid_argument(
                format!("types[{index}]"),
                "must be a string",
                operation,
            ));
        };
        if !DATA_TYPES.contains(&data_type) {
            return Err(HostProtocolError::invalid_argument(
                format!("types[{index}]"),
                "must be a known browsing data type",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_optional_non_empty(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.get(field).is_some() {
        validate_object_string(payload.get(field), field, operation)?;
    }
    Ok(())
}

fn validate_object_string<'a>(
    value: Option<&'a Value>,
    field: impl Into<String>,
    operation: &'static str,
) -> Result<&'a str, HostProtocolError> {
    let field = field.into();
    let value = value.and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(&field, "must be a string", operation)
    })?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(value)
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{clear, estimate, is_supported, list_types};
    use serde_json::json;

    #[test]
    fn browsing_data_methods_validate_then_report_unsupported() {
        let clear_error = clear(Some(json!({
            "profile": profile(),
            "types": ["cache", "cookies"]
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(clear_error.tag(), "Unsupported");

        let estimate_error = estimate(Some(json!({
            "profile": profile(),
            "types": ["history"]
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(estimate_error.tag(), "Unsupported");

        let list_error = list_types(None).expect_err("host adapter is not implemented yet");
        assert_eq!(list_error.tag(), "Unsupported");
    }

    #[test]
    fn browsing_data_methods_reject_invalid_payloads_before_unsupported() {
        let empty_types = clear(Some(json!({
            "profile": profile(),
            "types": []
        })))
        .expect_err("empty types should fail");
        assert_eq!(empty_types.tag(), "InvalidArgument");

        let unknown_type = estimate(Some(json!({
            "profile": profile(),
            "types": ["passwords"]
        })))
        .expect_err("unknown type should fail");
        assert_eq!(unknown_type.tag(), "InvalidArgument");

        let wrong_profile = clear(Some(json!({
            "profile": {
                "kind": "webview",
                "id": "session-profile:workspace-1",
                "generation": 0,
                "ownerScope": "workspace:1",
                "state": "open"
            },
            "types": ["cache"]
        })))
        .expect_err("wrong profile kind should fail");
        assert_eq!(wrong_profile.tag(), "InvalidArgument");
    }

    #[test]
    fn browsing_data_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-browsing-data-unavailable"
            })
        );
    }

    fn profile() -> serde_json::Value {
        json!({
            "kind": "session-profile",
            "id": "session-profile:workspace-1",
            "generation": 0,
            "ownerScope": "workspace:1",
            "state": "open"
        })
    }
}

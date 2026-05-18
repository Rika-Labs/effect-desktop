#![allow(clippy::result_large_err)]

use host_protocol::{
    HostProtocolError, HostProtocolPlatform, ResidentLifecycleDisablePayload,
    ResidentLifecycleEnablePayload, ResidentLifecycleSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn enable(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ResidentLifecycleEnablePayload>(
        payload,
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
    )?;
    validate_optional_printable(
        "ownerScope",
        input.owner_scope(),
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
    )?;
    validate_optional_printable(
        "traceId",
        input.trace_id(),
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
    )?;
    Err(unsupported(host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD))
}

pub(crate) fn disable(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ResidentLifecycleDisablePayload>(
        payload,
        host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD,
    )?;
    validate_optional_printable(
        "traceId",
        input.trace_id(),
        host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD,
    )?;
    Err(unsupported(
        host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD,
    ))
}

pub(crate) fn get_state() -> Result<Option<Value>, HostProtocolError> {
    Err(unsupported(
        host_protocol::RESIDENT_LIFECYCLE_GET_STATE_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ResidentLifecycleSupportedPayload::unsupported(
            host_protocol::RESIDENT_LIFECYCLE_UNSUPPORTED_REASON,
        ),
        host_protocol::RESIDENT_LIFECYCLE_IS_SUPPORTED_METHOD,
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
            format!("failed to encode resident lifecycle payload: {error}"),
            operation,
        )
    })
}

fn validate_optional_printable(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(value) = value {
        if value.contains('\0') {
            return Err(HostProtocolError::invalid_argument(
                field,
                "must not contain NUL",
                operation,
            ));
        }
        if value.chars().any(char::is_control) {
            return Err(HostProtocolError::invalid_argument(
                field,
                "must not contain control characters",
                operation,
            ));
        }
        if value.trim().is_empty() {
            return Err(HostProtocolError::invalid_argument(
                field,
                "must be non-empty",
                operation,
            ));
        }
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::Unsupported {
        message: format!(
            "unsupported operation {operation}: {}",
            host_protocol::RESIDENT_LIFECYCLE_UNSUPPORTED_REASON
        ),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("Unsupported").expect("known tag"),
        remediation: None,
        docs_url: None,
        reason: host_protocol::RESIDENT_LIFECYCLE_UNSUPPORTED_REASON.to_string(),
    }
}

fn current_platform() -> HostProtocolPlatform {
    #[cfg(target_os = "macos")]
    {
        HostProtocolPlatform::Macos
    }
    #[cfg(target_os = "windows")]
    {
        HostProtocolPlatform::Windows
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        HostProtocolPlatform::Linux
    }
}

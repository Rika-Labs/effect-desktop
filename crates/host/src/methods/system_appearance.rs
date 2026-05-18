#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, SystemAppearanceIsSupportedPayload, SystemAppearanceSupportedPayload,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{to_value, Value};

pub(crate) fn get_appearance(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
    ))
}

pub(crate) fn get_accent_color(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::SYSTEM_APPEARANCE_GET_ACCENT_COLOR_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SYSTEM_APPEARANCE_GET_ACCENT_COLOR_METHOD,
    ))
}

pub(crate) fn get_reduced_motion(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_MOTION_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_MOTION_METHOD,
    ))
}

pub(crate) fn get_reduced_transparency(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_TRANSPARENCY_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_TRANSPARENCY_METHOD,
    ))
}

pub(crate) fn is_supported(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let _input = decode_payload::<SystemAppearanceIsSupportedPayload>(
        payload,
        host_protocol::SYSTEM_APPEARANCE_IS_SUPPORTED_METHOD,
    )?;
    encode_payload(
        SystemAppearanceSupportedPayload::unsupported(),
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

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::SYSTEM_APPEARANCE_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{get_appearance, get_reduced_motion, is_supported};
    use host_protocol::HostProtocolError;
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
    fn system_appearance_support_reports_false_for_known_methods() {
        let payload = is_supported(Some(json!({ "method": "getAppearance" })))
            .expect("support query should return payload");
        assert_eq!(payload, Some(json!({ "supported": false })));
    }

    #[test]
    fn system_appearance_support_rejects_unknown_methods() {
        let error = is_supported(Some(json!({ "method": "theme" })))
            .expect_err("unknown method should reject");
        assert_eq!(error.tag(), "InvalidArgument");
    }
}

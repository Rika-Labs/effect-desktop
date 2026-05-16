#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, RealtimeMediaSessionIdentityPayload, RealtimeMediaSessionInterruptPayload,
    RealtimeMediaSessionSelectDevicePayload, RealtimeMediaSessionSupportedPayload,
    REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON,
};
use serde::de::DeserializeOwned;
use serde_json::{to_value, Value};

pub(crate) fn open(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<RealtimeMediaSessionIdentityPayload>(
        payload,
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
    )?;
    Err(unsupported(
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
    ))
}

pub(crate) fn close(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<RealtimeMediaSessionIdentityPayload>(
        payload,
        host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
    )?;
    Err(unsupported(
        host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
    ))
}

pub(crate) fn select_device(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<RealtimeMediaSessionSelectDevicePayload>(
        payload,
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;
    validate_non_empty(
        "deviceId",
        input.device_id(),
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;
    Err(unsupported(
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    ))
}

pub(crate) fn interrupt(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<RealtimeMediaSessionInterruptPayload>(
        payload,
        host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
    )?;
    Err(unsupported(
        host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    to_value(RealtimeMediaSessionSupportedPayload::unsupported(
        REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON,
    ))
    .map(Some)
    .map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode realtime media support payload: {error}"),
            host_protocol::REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD,
        )
    })
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

fn validate_identity(
    profile_id: &str,
    session_id: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("profileId", profile_id, operation)?;
    validate_non_empty("sessionId", session_id, operation)
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ))
    } else if value.as_bytes().contains(&0) {
        Err(HostProtocolError::invalid_argument(
            field,
            "must not include NUL bytes",
            operation,
        ))
    } else {
        Ok(())
    }
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{close, interrupt, open, select_device};
    use serde_json::json;

    #[test]
    fn open_validates_identity_before_returning_unsupported() {
        let error = open(Some(json!({
            "profileId": "profile-1",
            "sessionId": "session-1"
        })))
        .expect_err("adapter is intentionally unsupported");

        assert_eq!(error.tag(), "Unsupported");
    }

    #[test]
    fn open_rejects_empty_profile_id_before_unsupported() {
        let error = open(Some(json!({
            "profileId": "",
            "sessionId": "session-1"
        })))
        .expect_err("empty profile id should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn open_rejects_nul_profile_id_before_unsupported() {
        let error = open(Some(json!({
            "profileId": "profile\u{0000}1",
            "sessionId": "session-1"
        })))
        .expect_err("NUL profile id should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn close_rejects_nul_session_id_before_unsupported() {
        let error = close(Some(json!({
            "profileId": "profile-1",
            "sessionId": "session\u{0000}1"
        })))
        .expect_err("NUL session id should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn close_rejects_unknown_fields() {
        let error = close(Some(json!({
            "profileId": "profile-1",
            "sessionId": "session-1",
            "extra": true
        })))
        .expect_err("unknown fields should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn select_device_rejects_empty_device_id() {
        let error = select_device(Some(json!({
            "profileId": "profile-1",
            "sessionId": "session-1",
            "kind": "microphone",
            "deviceId": ""
        })))
        .expect_err("empty device id should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn select_device_rejects_nul_device_id() {
        let error = select_device(Some(json!({
            "profileId": "profile-1",
            "sessionId": "session-1",
            "kind": "microphone",
            "deviceId": "mic\u{0000}1"
        })))
        .expect_err("NUL device id should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn interrupt_rejects_unknown_reason() {
        let error = interrupt(Some(json!({
            "profileId": "profile-1",
            "sessionId": "session-1",
            "reason": "missing"
        })))
        .expect_err("unknown reason should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }
}

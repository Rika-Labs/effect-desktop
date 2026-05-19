#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::HostProtocolError;
use host_protocol::{AppQuitPayload, AppRestartPayload};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) fn quit(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(payload.as_ref(), "exitCode", host_protocol::APP_QUIT_METHOD)?;
    let _input = decode_payload::<AppQuitPayload>(payload, host_protocol::APP_QUIT_METHOD)?;
    Err(unsupported(host_protocol::APP_QUIT_METHOD))
}

pub(crate) fn restart(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(payload.as_ref(), "args", host_protocol::APP_RESTART_METHOD)?;
    let input = decode_payload::<AppRestartPayload>(payload, host_protocol::APP_RESTART_METHOD)?;
    validate_args(input.args(), host_protocol::APP_RESTART_METHOD)?;
    Err(unsupported(host_protocol::APP_RESTART_METHOD))
}

pub(crate) fn focus(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::APP_FOCUS_METHOD)?;
    let current = handler.get_current()?;
    handler.focus(current.window_id())?;
    Ok(None)
}

pub(crate) fn request_single_instance_lock(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
    )?;
    Err(unsupported(
        host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
    ))
}

fn reject_unexpected_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        )),
    }
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

fn reject_null_field(
    payload: Option<&Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if matches!(
        payload
            .and_then(Value::as_object)
            .and_then(|object| object.get(field)),
        Some(Value::Null)
    ) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be omitted instead of null",
            operation,
        ));
    }
    Ok(())
}

fn validate_args(
    args: Option<&[String]>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(args) = args else {
        return Ok(());
    };
    for argument in args {
        if argument.is_empty() {
            return Err(HostProtocolError::invalid_argument(
                "args",
                "entries must be non-empty",
                operation,
            ));
        }
        if argument.contains('\0') {
            return Err(HostProtocolError::invalid_argument(
                "args",
                "entries must not contain NUL bytes",
                operation,
            ));
        }
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::APP_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{quit, request_single_instance_lock, restart};
    use host_protocol::HostProtocolError;
    use serde_json::{json, Value};

    #[test]
    fn app_void_requests_decode_before_unsupported() {
        assert_eq!(
            request_single_instance_lock(None).expect_err("single instance"),
            HostProtocolError::unsupported(
                host_protocol::APP_UNSUPPORTED_REASON,
                host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
            )
        );
    }

    #[test]
    fn app_void_requests_accept_null_as_wire_void() {
        assert_eq!(
            request_single_instance_lock(Some(Value::Null)).expect_err("null payload"),
            HostProtocolError::unsupported(
                host_protocol::APP_UNSUPPORTED_REASON,
                host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
            )
        );
    }

    #[test]
    fn app_void_requests_reject_non_null_present_payloads() {
        assert_eq!(
            request_single_instance_lock(Some(json!({}))).expect_err("object payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
            )
        );
    }

    #[test]
    fn app_payload_requests_decode_before_unsupported() {
        assert_eq!(
            quit(Some(json!({ "exitCode": 0 }))).expect_err("quit"),
            HostProtocolError::unsupported(
                host_protocol::APP_UNSUPPORTED_REASON,
                host_protocol::APP_QUIT_METHOD,
            )
        );
        assert_eq!(
            restart(Some(json!({ "args": ["--restarted"] }))).expect_err("restart"),
            HostProtocolError::unsupported(
                host_protocol::APP_UNSUPPORTED_REASON,
                host_protocol::APP_RESTART_METHOD,
            )
        );
    }

    #[test]
    fn app_payload_requests_reject_malformed_inputs_before_unsupported() {
        assert_eq!(
            quit(Some(json!({ "exitCode": null }))).expect_err("exit code"),
            HostProtocolError::invalid_argument(
                "exitCode",
                "must be omitted instead of null",
                host_protocol::APP_QUIT_METHOD,
            )
        );
        assert_eq!(
            quit(Some(json!({ "exitCode": 256 })))
                .expect_err("exit code range")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            restart(Some(json!({ "args": null }))).expect_err("args null"),
            HostProtocolError::invalid_argument(
                "args",
                "must be omitted instead of null",
                host_protocol::APP_RESTART_METHOD,
            )
        );
        assert_eq!(
            restart(Some(json!({ "args": ["bad\0arg"] })))
                .expect_err("args")
                .tag(),
            "InvalidArgument"
        );
    }
}

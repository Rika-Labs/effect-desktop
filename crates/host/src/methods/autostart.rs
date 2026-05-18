#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{AutostartEnablePayload, HostProtocolError};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) fn is_enabled(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::AUTOSTART_IS_ENABLED_METHOD)?;
    Err(unsupported(host_protocol::AUTOSTART_IS_ENABLED_METHOD))
}

pub(crate) fn enable(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(
        payload.as_ref(),
        "args",
        host_protocol::AUTOSTART_ENABLE_METHOD,
    )?;
    let input = decode_payload::<AutostartEnablePayload>(
        payload.unwrap_or_else(|| Value::Object(Default::default())),
        host_protocol::AUTOSTART_ENABLE_METHOD,
    )?;
    if let Some(args) = input.args() {
        for arg in args {
            validate_arg(arg, host_protocol::AUTOSTART_ENABLE_METHOD)?;
        }
    }
    Err(unsupported(host_protocol::AUTOSTART_ENABLE_METHOD))
}

pub(crate) fn disable(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::AUTOSTART_DISABLE_METHOD)?;
    Err(unsupported(host_protocol::AUTOSTART_DISABLE_METHOD))
}

fn decode_payload<T: DeserializeOwned>(
    payload: Value,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn reject_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Object(object)) if object.is_empty() => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        )),
    }
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

fn validate_arg(arg: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if arg.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "args",
            "entries must be non-empty",
            operation,
        ));
    }
    if arg.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            "args",
            "entries must not contain NUL bytes",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::AUTOSTART_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{disable, enable, is_enabled};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn autostart_requests_decode_before_unsupported() {
        assert_eq!(
            is_enabled(None).expect_err("is enabled"),
            HostProtocolError::unsupported(
                host_protocol::AUTOSTART_UNSUPPORTED_REASON,
                host_protocol::AUTOSTART_IS_ENABLED_METHOD,
            )
        );
        assert_eq!(
            enable(Some(json!({ "args": ["--hidden"] }))).expect_err("enable"),
            HostProtocolError::unsupported(
                host_protocol::AUTOSTART_UNSUPPORTED_REASON,
                host_protocol::AUTOSTART_ENABLE_METHOD,
            )
        );
        assert_eq!(
            disable(None).expect_err("disable"),
            HostProtocolError::unsupported(
                host_protocol::AUTOSTART_UNSUPPORTED_REASON,
                host_protocol::AUTOSTART_DISABLE_METHOD,
            )
        );
    }

    #[test]
    fn autostart_requests_reject_invalid_inputs_before_unsupported() {
        assert_eq!(
            enable(Some(json!({ "args": null }))).expect_err("null args"),
            HostProtocolError::invalid_argument(
                "args",
                "must be omitted instead of null",
                host_protocol::AUTOSTART_ENABLE_METHOD,
            )
        );
        assert_eq!(
            enable(Some(json!({ "args": [""] })))
                .expect_err("empty arg")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            enable(Some(json!({ "args": ["bad\0arg"] })))
                .expect_err("nul arg")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            disable(Some(json!({ "unexpected": true }))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::AUTOSTART_DISABLE_METHOD,
            )
        );
    }
}

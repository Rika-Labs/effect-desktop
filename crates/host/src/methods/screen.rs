#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::{HostProtocolError, ScreenIsSupportedPayload};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn get_displays(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::SCREEN_GET_DISPLAYS_METHOD)?;
    encode_payload(
        handler.get_screen_displays()?,
        host_protocol::SCREEN_GET_DISPLAYS_METHOD,
    )
}

pub(crate) fn get_primary_display(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::SCREEN_GET_PRIMARY_DISPLAY_METHOD)?;
    encode_payload(
        handler.get_primary_screen_display()?,
        host_protocol::SCREEN_GET_PRIMARY_DISPLAY_METHOD,
    )
}

pub(crate) fn get_pointer_point(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::SCREEN_GET_POINTER_POINT_METHOD)?;
    encode_payload(
        handler.get_screen_pointer_point()?,
        host_protocol::SCREEN_GET_POINTER_POINT_METHOD,
    )
}

pub(crate) fn is_supported(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ScreenIsSupportedPayload>(
        payload,
        host_protocol::SCREEN_IS_SUPPORTED_METHOD,
    )?;
    encode_payload(
        handler.screen_is_supported(input.method())?,
        host_protocol::SCREEN_IS_SUPPORTED_METHOD,
    )
}

fn reject_payload(
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
    to_value(payload)
        .map(Some)
        .map_err(|error| HostProtocolError::invalid_output(operation, error.to_string()))
}

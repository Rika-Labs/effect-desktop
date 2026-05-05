#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::{WindowCreateRequest, WindowMethodHandler};
use host_protocol::{
    HostProtocolError, WindowCreatePayload, WindowCreateResponse, WindowDestroyPayload,
};
use serde_json::Value;

pub(crate) fn create(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_optional_create_payload(payload)?;
    let response = handler.create(WindowCreateRequest::try_from(payload)?)?;

    Ok(Some(encode_create_response(response)?))
}

pub(crate) fn destroy(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_destroy_payload(payload)?;
    handler.destroy(payload.window_id())?;

    Ok(None)
}

fn decode_optional_create_payload(
    payload: Option<Value>,
) -> Result<WindowCreatePayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_create_payload(payload),
        None => Ok(WindowCreatePayload::default()),
    }
}

fn decode_required_destroy_payload(
    payload: Option<Value>,
) -> Result<WindowDestroyPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_destroy_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!("{} requires payload", host_protocol::WINDOW_DESTROY_METHOD),
            host_protocol::WINDOW_DESTROY_METHOD,
        )),
    }
}

fn decode_create_payload(payload: Value) -> Result<WindowCreatePayload, HostProtocolError> {
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_CREATE_METHOD,
        )
    })
}

fn decode_destroy_payload(payload: Value) -> Result<WindowDestroyPayload, HostProtocolError> {
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_DESTROY_METHOD,
        )
    })
}

fn encode_create_response(payload: WindowCreateResponse) -> Result<Value, HostProtocolError> {
    serde_json::to_value(payload).map_err(|error| {
        HostProtocolError::internal(
            format!(
                "failed to encode {} response payload: {error}",
                host_protocol::WINDOW_CREATE_METHOD
            ),
            host_protocol::WINDOW_CREATE_METHOD,
        )
    })
}

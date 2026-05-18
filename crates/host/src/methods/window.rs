#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::{WindowCreateRequest, WindowMethodHandler};
use host_protocol::{
    HostProtocolError, WindowBoundsPayload, WindowCreatePayload, WindowCreateResponse,
    WindowDestroyPayload, WindowSetBoundsPayload, WindowSetFullscreenPayload, WindowStatePayload,
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

pub(crate) fn show(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_SHOW_METHOD)?;
    handler.show(payload.window_id())?;

    Ok(None)
}

pub(crate) fn hide(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_HIDE_METHOD)?;
    handler.hide(payload.window_id())?;

    Ok(None)
}

pub(crate) fn focus(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_FOCUS_METHOD)?;
    handler.focus(payload.window_id())?;

    Ok(None)
}

pub(crate) fn get_bounds(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_GET_BOUNDS_METHOD)?;
    let response = handler.get_bounds(payload.window_id())?;

    Ok(Some(encode_bounds_response(response)?))
}

pub(crate) fn set_bounds(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_bounds_payload(payload)?;
    handler.set_bounds(payload.window_id(), payload.bounds())?;

    Ok(None)
}

pub(crate) fn center(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_CENTER_METHOD)?;
    handler.center(payload.window_id())?;

    Ok(None)
}

pub(crate) fn minimize(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_MINIMIZE_METHOD)?;
    handler.minimize(payload.window_id())?;

    Ok(None)
}

pub(crate) fn maximize(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_MAXIMIZE_METHOD)?;
    handler.maximize(payload.window_id())?;

    Ok(None)
}

pub(crate) fn restore(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_RESTORE_METHOD)?;
    handler.restore(payload.window_id())?;

    Ok(None)
}

pub(crate) fn set_fullscreen(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_fullscreen_payload(payload)?;
    handler.set_fullscreen(payload.window_id(), payload.fullscreen())?;

    Ok(None)
}

pub(crate) fn get_state(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_GET_STATE_METHOD)?;
    let response = handler.get_state(payload.window_id())?;

    Ok(Some(encode_state_response(response)?))
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
    decode_required_window_payload(payload, host_protocol::WINDOW_DESTROY_METHOD)
}

fn decode_required_window_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<WindowDestroyPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_window_payload(payload, operation),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!("{operation} requires payload"),
            operation,
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

fn decode_window_payload(
    payload: Value,
    operation: &'static str,
) -> Result<WindowDestroyPayload, HostProtocolError> {
    let payload: WindowDestroyPayload = serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            operation,
        ));
    }
    Ok(payload)
}

fn decode_required_set_bounds_payload(
    payload: Option<Value>,
) -> Result<WindowSetBoundsPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_bounds_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_BOUNDS_METHOD
            ),
            host_protocol::WINDOW_SET_BOUNDS_METHOD,
        )),
    }
}

fn decode_set_bounds_payload(payload: Value) -> Result<WindowSetBoundsPayload, HostProtocolError> {
    let payload: WindowSetBoundsPayload = serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_SET_BOUNDS_METHOD,
        )
    })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_BOUNDS_METHOD,
        ));
    }
    let bounds = payload.bounds();
    if !bounds.x().is_finite() || !bounds.y().is_finite() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "bounds coordinates must be finite",
            host_protocol::WINDOW_SET_BOUNDS_METHOD,
        ));
    }
    if !bounds.width().is_finite()
        || !bounds.height().is_finite()
        || bounds.width() <= 0.0
        || bounds.height() <= 0.0
    {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "bounds size must be finite and positive",
            host_protocol::WINDOW_SET_BOUNDS_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_fullscreen_payload(
    payload: Option<Value>,
) -> Result<WindowSetFullscreenPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_fullscreen_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_FULLSCREEN_METHOD
            ),
            host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
        )),
    }
}

fn decode_set_fullscreen_payload(
    payload: Value,
) -> Result<WindowSetFullscreenPayload, HostProtocolError> {
    let payload: WindowSetFullscreenPayload = serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
        )
    })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
        ));
    }
    Ok(payload)
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

fn encode_bounds_response(payload: WindowBoundsPayload) -> Result<Value, HostProtocolError> {
    serde_json::to_value(payload).map_err(|error| {
        HostProtocolError::internal(
            format!(
                "failed to encode {} response payload: {error}",
                host_protocol::WINDOW_GET_BOUNDS_METHOD
            ),
            host_protocol::WINDOW_GET_BOUNDS_METHOD,
        )
    })
}

fn encode_state_response(payload: WindowStatePayload) -> Result<Value, HostProtocolError> {
    serde_json::to_value(payload).map_err(|error| {
        HostProtocolError::internal(
            format!(
                "failed to encode {} response payload: {error}",
                host_protocol::WINDOW_GET_STATE_METHOD
            ),
            host_protocol::WINDOW_GET_STATE_METHOD,
        )
    })
}

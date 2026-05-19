#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::{WindowCreateRequest, WindowMethodHandler};
use host_protocol::{
    HostProtocolError, WindowBoundsPayload, WindowCenterOnDisplayPayload, WindowCreatePayload,
    WindowCreateResponse, WindowDestroyPayload, WindowListResponse, WindowLookupResponse,
    WindowParentResponse, WindowRequestAttentionPayload, WindowSetAlwaysOnTopPayload,
    WindowSetBoundsPayload, WindowSetDecorationsPayload, WindowSetFullscreenPayload,
    WindowSetProgressPayload, WindowSetResizablePayload, WindowSetShadowPayload,
    WindowSetSkipTaskbarPayload, WindowSetTitlePayload, WindowSetTrafficLightsPayload,
    WindowSetVibrancyPayload, WindowStatePayload,
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

pub(crate) fn get_current(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    decode_empty_payload(payload, host_protocol::WINDOW_GET_CURRENT_METHOD)?;
    let response = handler.get_current()?;

    Ok(Some(encode_lookup_response(
        response,
        host_protocol::WINDOW_GET_CURRENT_METHOD,
    )?))
}

pub(crate) fn get_by_id(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_GET_BY_ID_METHOD)?;
    let response = handler.get_by_id(payload.window_id())?;

    Ok(Some(encode_lookup_response(
        response,
        host_protocol::WINDOW_GET_BY_ID_METHOD,
    )?))
}

pub(crate) fn list(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    decode_empty_payload(payload, host_protocol::WINDOW_LIST_METHOD)?;
    let response = handler.list()?;

    Ok(Some(encode_list_response(
        response,
        host_protocol::WINDOW_LIST_METHOD,
    )?))
}

pub(crate) fn get_parent(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_window_payload(payload, host_protocol::WINDOW_GET_PARENT_METHOD)?;
    let response = handler.get_parent(payload.window_id())?;

    Ok(Some(encode_parent_response(response)?))
}

pub(crate) fn get_children(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload =
        decode_required_window_payload(payload, host_protocol::WINDOW_GET_CHILDREN_METHOD)?;
    let response = handler.get_children(payload.window_id())?;

    Ok(Some(encode_list_response(
        response,
        host_protocol::WINDOW_GET_CHILDREN_METHOD,
    )?))
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

pub(crate) fn center_on_display(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_center_on_display_payload(payload)?;
    handler.center_on_display(payload.window_id(), payload.display_id())?;

    Ok(None)
}

pub(crate) fn set_title(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_title_payload(payload)?;
    handler.set_title(payload.window_id(), payload.title())?;

    Ok(None)
}

pub(crate) fn set_resizable(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_resizable_payload(payload)?;
    handler.set_resizable(payload.window_id(), payload.resizable())?;

    Ok(None)
}

pub(crate) fn set_decorations(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_decorations_payload(payload)?;
    handler.set_decorations(payload.window_id(), payload.decorations())?;

    Ok(None)
}

pub(crate) fn set_traffic_lights(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_traffic_lights_payload(payload)?;
    handler.set_traffic_lights(payload.window_id(), payload.traffic_lights())?;

    Ok(None)
}

pub(crate) fn set_vibrancy(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_vibrancy_payload(payload)?;
    handler.set_vibrancy(payload.window_id(), payload.material())?;

    Ok(None)
}

pub(crate) fn set_shadow(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_shadow_payload(payload)?;
    handler.set_shadow(payload.window_id(), payload.has_shadow())?;

    Ok(None)
}

pub(crate) fn set_always_on_top(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_always_on_top_payload(payload)?;
    handler.set_always_on_top(payload.window_id(), payload.always_on_top())?;

    Ok(None)
}

pub(crate) fn set_skip_taskbar(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_skip_taskbar_payload(payload)?;
    handler.set_skip_taskbar(payload.window_id(), payload.skip_taskbar())?;

    Ok(None)
}

pub(crate) fn set_progress(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_set_progress_payload(payload)?;
    handler.set_progress(payload.window_id(), &payload)?;

    Ok(None)
}

pub(crate) fn request_attention(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_required_request_attention_payload(payload)?;
    handler.request_attention(payload.window_id(), payload.request_type())?;

    Ok(None)
}

pub(crate) fn cancel_attention(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload =
        decode_required_window_payload(payload, host_protocol::WINDOW_CANCEL_ATTENTION_METHOD)?;
    handler.cancel_attention(payload.window_id())?;

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

fn decode_empty_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.is_none() {
        return Ok(());
    }

    Err(HostProtocolError::invalid_argument(
        "payload",
        format!("{operation} does not accept payload"),
        operation,
    ))
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

fn decode_required_center_on_display_payload(
    payload: Option<Value>,
) -> Result<WindowCenterOnDisplayPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_center_on_display_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD
            ),
            host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
        )),
    }
}

fn decode_center_on_display_payload(
    payload: Value,
) -> Result<WindowCenterOnDisplayPayload, HostProtocolError> {
    let payload: WindowCenterOnDisplayPayload =
        serde_json::from_value(payload).map_err(|error| {
            HostProtocolError::invalid_argument(
                "payload",
                error.to_string(),
                host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
            )
        })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
        ));
    }
    if payload.display_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "displayId must be non-empty",
            host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_title_payload(
    payload: Option<Value>,
) -> Result<WindowSetTitlePayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_title_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_TITLE_METHOD
            ),
            host_protocol::WINDOW_SET_TITLE_METHOD,
        )),
    }
}

fn decode_set_title_payload(payload: Value) -> Result<WindowSetTitlePayload, HostProtocolError> {
    let payload: WindowSetTitlePayload = serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_SET_TITLE_METHOD,
        )
    })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_TITLE_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_resizable_payload(
    payload: Option<Value>,
) -> Result<WindowSetResizablePayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_resizable_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_RESIZABLE_METHOD
            ),
            host_protocol::WINDOW_SET_RESIZABLE_METHOD,
        )),
    }
}

fn decode_set_resizable_payload(
    payload: Value,
) -> Result<WindowSetResizablePayload, HostProtocolError> {
    let payload: WindowSetResizablePayload = serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_SET_RESIZABLE_METHOD,
        )
    })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_RESIZABLE_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_decorations_payload(
    payload: Option<Value>,
) -> Result<WindowSetDecorationsPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_decorations_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_DECORATIONS_METHOD
            ),
            host_protocol::WINDOW_SET_DECORATIONS_METHOD,
        )),
    }
}

fn decode_set_decorations_payload(
    payload: Value,
) -> Result<WindowSetDecorationsPayload, HostProtocolError> {
    let payload: WindowSetDecorationsPayload =
        serde_json::from_value(payload).map_err(|error| {
            HostProtocolError::invalid_argument(
                "payload",
                error.to_string(),
                host_protocol::WINDOW_SET_DECORATIONS_METHOD,
            )
        })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_DECORATIONS_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_traffic_lights_payload(
    payload: Option<Value>,
) -> Result<WindowSetTrafficLightsPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_traffic_lights_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD
            ),
            host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
        )),
    }
}

fn decode_set_traffic_lights_payload(
    payload: Value,
) -> Result<WindowSetTrafficLightsPayload, HostProtocolError> {
    let payload: WindowSetTrafficLightsPayload =
        serde_json::from_value(payload).map_err(|error| {
            HostProtocolError::invalid_argument(
                "payload",
                error.to_string(),
                host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
            )
        })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_vibrancy_payload(
    payload: Option<Value>,
) -> Result<WindowSetVibrancyPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_vibrancy_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_VIBRANCY_METHOD
            ),
            host_protocol::WINDOW_SET_VIBRANCY_METHOD,
        )),
    }
}

fn decode_set_vibrancy_payload(
    payload: Value,
) -> Result<WindowSetVibrancyPayload, HostProtocolError> {
    let payload: WindowSetVibrancyPayload = serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_SET_VIBRANCY_METHOD,
        )
    })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_VIBRANCY_METHOD,
        ));
    }
    if payload.material().trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "material must be non-empty",
            host_protocol::WINDOW_SET_VIBRANCY_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_shadow_payload(
    payload: Option<Value>,
) -> Result<WindowSetShadowPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_shadow_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_SHADOW_METHOD
            ),
            host_protocol::WINDOW_SET_SHADOW_METHOD,
        )),
    }
}

fn decode_set_shadow_payload(payload: Value) -> Result<WindowSetShadowPayload, HostProtocolError> {
    let payload: WindowSetShadowPayload = serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_SET_SHADOW_METHOD,
        )
    })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_SHADOW_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_always_on_top_payload(
    payload: Option<Value>,
) -> Result<WindowSetAlwaysOnTopPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_always_on_top_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_ALWAYS_ON_TOP_METHOD
            ),
            host_protocol::WINDOW_SET_ALWAYS_ON_TOP_METHOD,
        )),
    }
}

fn decode_set_always_on_top_payload(
    payload: Value,
) -> Result<WindowSetAlwaysOnTopPayload, HostProtocolError> {
    let payload: WindowSetAlwaysOnTopPayload =
        serde_json::from_value(payload).map_err(|error| {
            HostProtocolError::invalid_argument(
                "payload",
                error.to_string(),
                host_protocol::WINDOW_SET_ALWAYS_ON_TOP_METHOD,
            )
        })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_ALWAYS_ON_TOP_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_skip_taskbar_payload(
    payload: Option<Value>,
) -> Result<WindowSetSkipTaskbarPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_skip_taskbar_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD
            ),
            host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
        )),
    }
}

fn decode_set_skip_taskbar_payload(
    payload: Value,
) -> Result<WindowSetSkipTaskbarPayload, HostProtocolError> {
    let payload: WindowSetSkipTaskbarPayload =
        serde_json::from_value(payload).map_err(|error| {
            HostProtocolError::invalid_argument(
                "payload",
                error.to_string(),
                host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
            )
        })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_set_progress_payload(
    payload: Option<Value>,
) -> Result<WindowSetProgressPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_set_progress_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_SET_PROGRESS_METHOD
            ),
            host_protocol::WINDOW_SET_PROGRESS_METHOD,
        )),
    }
}

fn decode_set_progress_payload(
    payload: Value,
) -> Result<WindowSetProgressPayload, HostProtocolError> {
    let payload: WindowSetProgressPayload = serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::WINDOW_SET_PROGRESS_METHOD,
        )
    })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_SET_PROGRESS_METHOD,
        ));
    }
    if payload.progress().is_some_and(|progress| progress > 100) {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "progress must be between 0 and 100",
            host_protocol::WINDOW_SET_PROGRESS_METHOD,
        ));
    }
    if payload
        .desktop_filename()
        .is_some_and(|desktop_filename| desktop_filename.is_empty())
    {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "desktopFilename must be non-empty",
            host_protocol::WINDOW_SET_PROGRESS_METHOD,
        ));
    }
    Ok(payload)
}

fn decode_required_request_attention_payload(
    payload: Option<Value>,
) -> Result<WindowRequestAttentionPayload, HostProtocolError> {
    match payload {
        Some(payload) => decode_request_attention_payload(payload),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            format!(
                "{} requires payload",
                host_protocol::WINDOW_REQUEST_ATTENTION_METHOD
            ),
            host_protocol::WINDOW_REQUEST_ATTENTION_METHOD,
        )),
    }
}

fn decode_request_attention_payload(
    payload: Value,
) -> Result<WindowRequestAttentionPayload, HostProtocolError> {
    let payload: WindowRequestAttentionPayload =
        serde_json::from_value(payload).map_err(|error| {
            HostProtocolError::invalid_argument(
                "payload",
                error.to_string(),
                host_protocol::WINDOW_REQUEST_ATTENTION_METHOD,
            )
        })?;
    if payload.window_id().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "windowId must be non-empty",
            host_protocol::WINDOW_REQUEST_ATTENTION_METHOD,
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

fn encode_lookup_response(
    payload: WindowLookupResponse,
    operation: &'static str,
) -> Result<Value, HostProtocolError> {
    serde_json::to_value(payload).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode {operation} response payload: {error}"),
            operation,
        )
    })
}

fn encode_list_response(
    payload: WindowListResponse,
    operation: &'static str,
) -> Result<Value, HostProtocolError> {
    serde_json::to_value(payload).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode {operation} response payload: {error}"),
            operation,
        )
    })
}

fn encode_parent_response(payload: WindowParentResponse) -> Result<Value, HostProtocolError> {
    serde_json::to_value(payload).map_err(|error| {
        HostProtocolError::internal(
            format!(
                "failed to encode {} response payload: {error}",
                host_protocol::WINDOW_GET_PARENT_METHOD
            ),
            host_protocol::WINDOW_GET_PARENT_METHOD,
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

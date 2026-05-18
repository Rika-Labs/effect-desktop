#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::{TrayCreateRequest, WindowMethodHandler};
use host_protocol::{
    HostProtocolEnvelope, HostProtocolError, TrayCreatePayload, TrayDestroyPayload,
    TrayResourcePayload, TraySetIconPayload, TraySetMenuPayload, TraySetTitlePayload,
    TraySetTooltipPayload, TraySupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::sync::mpsc::Sender;

pub(crate) fn create_with_event_sender(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TrayCreatePayload>(payload, host_protocol::TRAY_CREATE_METHOD)?;
    validate_icon(input.icon(), host_protocol::TRAY_CREATE_METHOD)?;
    validate_optional_text(
        "tooltip",
        input.tooltip(),
        host_protocol::TRAY_CREATE_METHOD,
    )?;
    validate_optional_text("title", input.title(), host_protocol::TRAY_CREATE_METHOD)?;
    if let Some(menu) = input.menu() {
        validate_menu(menu, host_protocol::TRAY_CREATE_METHOD)?;
    }

    let tray = handler.create_tray(TrayCreateRequest::new(
        input.icon().to_string(),
        input.tooltip().map(ToString::to_string),
        input.title().map(ToString::to_string),
        input.menu().cloned(),
        event_sender,
    ))?;

    encode_payload(tray, host_protocol::TRAY_CREATE_METHOD)
}

pub(crate) fn set_icon(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TraySetIconPayload>(payload, host_protocol::TRAY_SET_ICON_METHOD)?;
    validate_tray_handle(input.tray(), host_protocol::TRAY_SET_ICON_METHOD)?;
    validate_icon(input.icon(), host_protocol::TRAY_SET_ICON_METHOD)?;
    handler.set_tray_icon(input.tray(), input.icon().to_string())?;
    Ok(None)
}

pub(crate) fn set_tooltip(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<TraySetTooltipPayload>(payload, host_protocol::TRAY_SET_TOOLTIP_METHOD)?;
    validate_tray_handle(input.tray(), host_protocol::TRAY_SET_TOOLTIP_METHOD)?;
    validate_text(
        "tooltip",
        input.tooltip(),
        host_protocol::TRAY_SET_TOOLTIP_METHOD,
    )?;
    handler.set_tray_tooltip(input.tray(), input.tooltip().to_string())?;
    Ok(None)
}

pub(crate) fn set_title(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<TraySetTitlePayload>(payload, host_protocol::TRAY_SET_TITLE_METHOD)?;
    validate_tray_handle(input.tray(), host_protocol::TRAY_SET_TITLE_METHOD)?;
    validate_text("title", input.title(), host_protocol::TRAY_SET_TITLE_METHOD)?;
    handler.set_tray_title(input.tray(), input.title().to_string())?;
    Ok(None)
}

pub(crate) fn set_menu(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TraySetMenuPayload>(payload, host_protocol::TRAY_SET_MENU_METHOD)?;
    validate_tray_handle(input.tray(), host_protocol::TRAY_SET_MENU_METHOD)?;
    validate_menu(input.menu(), host_protocol::TRAY_SET_MENU_METHOD)?;
    handler.set_tray_menu(input.tray(), input.menu().clone())?;
    Ok(None)
}

pub(crate) fn destroy(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TrayDestroyPayload>(payload, host_protocol::TRAY_DESTROY_METHOD)?;
    validate_tray_handle(input.tray(), host_protocol::TRAY_DESTROY_METHOD)?;
    handler.destroy_tray(input.tray())?;
    Ok(None)
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        encode_payload(
            TraySupportedPayload::supported(),
            host_protocol::TRAY_IS_SUPPORTED_METHOD,
        )
    }

    #[cfg(target_os = "linux")]
    {
        encode_payload(
            TraySupportedPayload::unsupported(host_protocol::TRAY_UNSUPPORTED_REASON),
            host_protocol::TRAY_IS_SUPPORTED_METHOD,
        )
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

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload)
        .map(Some)
        .map_err(|error| HostProtocolError::invalid_output(operation, error.to_string()))
}

fn validate_tray_handle(
    tray: &TrayResourcePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("tray.id", tray.id(), operation)?;
    validate_non_empty("tray.ownerScope", tray.owner_scope(), operation)?;
    if tray.kind() != "tray" {
        return Err(HostProtocolError::invalid_argument(
            "tray.kind",
            "must be tray",
            operation,
        ));
    }
    if tray.state() != "open" {
        return Err(HostProtocolError::invalid_argument(
            "tray.state",
            "must be open",
            operation,
        ));
    }
    Ok(())
}

fn validate_icon(value: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    let Some(hex) = value.strip_prefix("solid:#") else {
        return Err(HostProtocolError::invalid_argument(
            "icon",
            "must be a solid:#RRGGBBAA tray icon",
            operation,
        ));
    };
    if hex.len() != 8 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(HostProtocolError::invalid_argument(
            "icon",
            "must include valid RGBA hex channels",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_text(
    field: &'static str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(value) = value {
        validate_text(field, value, operation)?;
    }
    Ok(())
}

fn validate_text(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f)) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_non_empty(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_menu(value: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    let Some(items) = value.get("items").and_then(Value::as_array) else {
        return Err(HostProtocolError::invalid_argument(
            "menu.items",
            "must be an array",
            operation,
        ));
    };
    for item in items {
        validate_menu_item(item, operation)?;
    }
    Ok(())
}

fn validate_menu_item(value: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    match value.get("type").and_then(Value::as_str) {
        Some("item") => {
            validate_non_empty(
                "menu.item.id",
                required_item_string(value, "id", operation)?,
                operation,
            )?;
            validate_non_empty(
                "menu.item.label",
                required_item_string(value, "label", operation)?,
                operation,
            )
        }
        Some("separator") => Ok(()),
        Some("submenu") => {
            validate_non_empty(
                "menu.item.id",
                required_item_string(value, "id", operation)?,
                operation,
            )?;
            validate_non_empty(
                "menu.item.label",
                required_item_string(value, "label", operation)?,
                operation,
            )?;
            let Some(items) = value.get("items").and_then(Value::as_array) else {
                return Err(HostProtocolError::invalid_argument(
                    "menu.item.items",
                    "must be an array",
                    operation,
                ));
            };
            for item in items {
                validate_menu_item(item, operation)?;
            }
            Ok(())
        }
        _ => Err(HostProtocolError::invalid_argument(
            "menu.item.type",
            "must be item, separator, or submenu",
            operation,
        )),
    }
}

fn required_item_string<'a>(
    value: &'a Value,
    field: &'static str,
    operation: &'static str,
) -> Result<&'a str, HostProtocolError> {
    value.get(field).and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(
            format!("menu.item.{field}"),
            "must be a string",
            operation,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{validate_icon, validate_menu};
    use serde_json::json;

    #[test]
    fn icon_requires_solid_rgba_hex() {
        assert!(validate_icon("solid:#3366ccff", host_protocol::TRAY_CREATE_METHOD).is_ok());
        assert!(validate_icon("app://assets/tray.png", host_protocol::TRAY_CREATE_METHOD).is_err());
        assert!(validate_icon("solid:#nope", host_protocol::TRAY_CREATE_METHOD).is_err());
    }

    #[test]
    fn menu_accepts_nested_template_entries() {
        let menu = json!({
            "items": [
                {
                    "type": "submenu",
                    "id": "file",
                    "label": "File",
                    "items": [{ "type": "item", "id": "quit", "label": "Quit" }]
                }
            ]
        });

        assert!(validate_menu(&menu, host_protocol::TRAY_SET_MENU_METHOD).is_ok());
    }
}

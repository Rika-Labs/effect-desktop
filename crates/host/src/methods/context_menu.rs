#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::{ContextMenuPosition, ContextMenuShowRequest, WindowMethodHandler};
use host_protocol::HostProtocolError;
use serde_json::Value;

pub(crate) fn show(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let request = decode_show_request(payload)?;
    handler.show_context_menu(request)?;
    Ok(None)
}

fn decode_show_request(
    payload: Option<Value>,
) -> Result<ContextMenuShowRequest, HostProtocolError> {
    let payload = required_payload(payload)?;
    validate_top_level_keys(&payload)?;

    let window_id = payload
        .get("window")
        .and_then(|window| window.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                "window.id",
                "must be a string",
                host_protocol::CONTEXT_MENU_SHOW_METHOD,
            )
        })?;
    validate_printable("window.id", window_id)?;

    let template = payload.get("template").cloned().ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "template",
            "is required",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )
    })?;
    validate_template(&template)?;

    let position = payload.get("position").ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "position",
            "is required",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )
    })?;
    let x = position.get("x").and_then(Value::as_f64).ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "position.x",
            "must be a number",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )
    })?;
    let y = position.get("y").and_then(Value::as_f64).ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "position.y",
            "must be a number",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )
    })?;
    let position = ContextMenuPosition::new(x, y)?;

    Ok(ContextMenuShowRequest::new(window_id, template, position))
}

fn validate_top_level_keys(payload: &Value) -> Result<(), HostProtocolError> {
    let Some(object) = payload.as_object() else {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "must be an object",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        ));
    };
    for key in object.keys() {
        if !matches!(key.as_str(), "window" | "template" | "position") {
            return Err(HostProtocolError::invalid_argument(
                key,
                "is not a supported ContextMenu.show field",
                host_protocol::CONTEXT_MENU_SHOW_METHOD,
            ));
        }
    }
    Ok(())
}

fn validate_template(template: &Value) -> Result<(), HostProtocolError> {
    let items = template
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                "template.items",
                "must be an array",
                host_protocol::CONTEXT_MENU_SHOW_METHOD,
            )
        })?;
    for item in items {
        validate_template_entry(item)?;
    }
    Ok(())
}

fn validate_template_entry(value: &Value) -> Result<(), HostProtocolError> {
    match value.get("type").and_then(Value::as_str) {
        Some("item") => {
            validate_menu_string(value, "id")?;
            validate_menu_string(value, "label")?;
            validate_optional_menu_string(value, "commandId")?;
            validate_optional_menu_string(value, "accelerator")?;
            validate_optional_bool(value, "enabled")?;
            validate_optional_bool(value, "checked")
        }
        Some("separator") => validate_optional_menu_string(value, "id"),
        Some("submenu") => {
            validate_menu_string(value, "id")?;
            validate_menu_string(value, "label")?;
            validate_optional_bool(value, "enabled")?;
            let items = value
                .get("items")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    HostProtocolError::invalid_argument(
                        "template.items.items",
                        "must be an array",
                        host_protocol::CONTEXT_MENU_SHOW_METHOD,
                    )
                })?;
            for item in items {
                validate_template_entry(item)?;
            }
            Ok(())
        }
        Some(_) => Err(HostProtocolError::invalid_argument(
            "template.items.type",
            "must be item, separator, or submenu",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )),
        None => Err(HostProtocolError::invalid_argument(
            "template.items.type",
            "must be a string",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )),
    }
}

fn validate_menu_string(value: &Value, field: &'static str) -> Result<(), HostProtocolError> {
    let text = value.get(field).and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(
            format!("template.items.{field}"),
            "must be a string",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )
    })?;
    validate_printable(format!("template.items.{field}"), text)
}

fn validate_optional_menu_string(
    value: &Value,
    field: &'static str,
) -> Result<(), HostProtocolError> {
    match value.get(field) {
        None => Ok(()),
        Some(Value::String(text)) => validate_printable(format!("template.items.{field}"), text),
        Some(_) => Err(HostProtocolError::invalid_argument(
            format!("template.items.{field}"),
            "must be a string",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )),
    }
}

fn validate_optional_bool(value: &Value, field: &'static str) -> Result<(), HostProtocolError> {
    match value.get(field) {
        None | Some(Value::Bool(_)) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            format!("template.items.{field}"),
            "must be a boolean",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )),
    }
}

fn validate_printable(field: impl Into<String>, value: &str) -> Result<(), HostProtocolError> {
    let field = field.into();
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        ));
    }
    if value.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f)) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        ));
    }
    Ok(())
}

fn required_payload(payload: Option<Value>) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "payload",
            "is required",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::decode_show_request;
    use serde_json::json;

    #[test]
    fn show_request_decodes_window_template_and_position() {
        let request = decode_show_request(Some(json!({
            "window": {
                "kind": "window",
                "id": "window-1",
                "generation": 0,
                "ownerScope": "scope-1",
                "state": "open"
            },
            "template": {
                "items": [
                    {
                        "type": "item",
                        "id": "file.open",
                        "label": "Open",
                        "commandId": "app.file.open"
                    }
                ]
            },
            "position": { "x": 12.5, "y": 34.25 }
        })))
        .expect("request should decode");

        assert_eq!(request.window_id(), "window-1");
    }

    #[test]
    fn show_request_rejects_control_bytes() {
        let error = decode_show_request(Some(json!({
            "window": { "id": "window-1" },
            "template": {
                "items": [
                    {
                        "type": "item",
                        "id": "file\nopen",
                        "label": "Open",
                        "commandId": "app.file.open"
                    }
                ]
            },
            "position": { "x": 12.5, "y": 34.25 }
        })))
        .expect_err("control bytes should fail");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn show_request_rejects_negative_position() {
        let error = decode_show_request(Some(json!({
            "window": { "id": "window-1" },
            "template": { "items": [] },
            "position": { "x": -1.0, "y": 34.25 }
        })))
        .expect_err("negative coordinates should fail");

        assert_eq!(error.tag(), "InvalidArgument");
    }
}

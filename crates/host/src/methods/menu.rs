#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::HostProtocolError;
use serde_json::Value;

pub(crate) fn set_application_menu(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let template = decode_template(payload, host_protocol::MENU_SET_APPLICATION_MENU_METHOD)?;
    handler.set_application_menu(template)?;

    Ok(None)
}

pub(crate) fn set_window_menu(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::MENU_SET_WINDOW_MENU_METHOD)?;
    let window_id = payload
        .get("window")
        .and_then(|window| window.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                "window.id",
                "must be a string",
                host_protocol::MENU_SET_WINDOW_MENU_METHOD,
            )
        })?;
    let template = payload.get("template").cloned().ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "template",
            "is required",
            host_protocol::MENU_SET_WINDOW_MENU_METHOD,
        )
    })?;
    validate_template(&template, host_protocol::MENU_SET_WINDOW_MENU_METHOD)?;
    handler.set_window_menu(window_id, template)?;

    Ok(None)
}

fn decode_template(payload: Option<Value>, operation: &str) -> Result<Value, HostProtocolError> {
    let payload = required_payload(payload, operation)?;
    let template = payload
        .get("template")
        .cloned()
        .ok_or_else(|| HostProtocolError::invalid_argument("template", "is required", operation))?;
    validate_template(&template, operation)?;

    Ok(template)
}

fn validate_template(template: &Value, operation: &str) -> Result<(), HostProtocolError> {
    let Some(items) = template.get("items").and_then(Value::as_array) else {
        return Err(HostProtocolError::invalid_argument(
            "template.items",
            "must be an array",
            operation,
        ));
    };

    if items.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "template.items",
            "must not be empty",
            operation,
        ));
    }

    if items
        .iter()
        .any(|item| item.get("type").and_then(Value::as_str) != Some("submenu"))
    {
        return Err(HostProtocolError::invalid_argument(
            "template.items",
            "application menu root items must be submenus",
            operation,
        ));
    }

    Ok(())
}

fn required_payload(payload: Option<Value>, operation: &str) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

#[cfg(test)]
mod tests {
    use super::decode_template;
    use serde_json::json;

    #[test]
    fn application_menu_template_requires_items() {
        assert!(decode_template(
            Some(json!({ "template": { "items": [] } })),
            host_protocol::MENU_SET_APPLICATION_MENU_METHOD,
        )
        .is_err());
    }

    #[test]
    fn application_menu_template_accepts_items() {
        let template = decode_template(
            Some(json!({
                "template": {
                    "items": [{ "type": "submenu", "id": "file", "label": "File", "items": [] }]
                }
            })),
            host_protocol::MENU_SET_APPLICATION_MENU_METHOD,
        )
        .expect("template");

        assert!(template.get("items").is_some());
    }

    #[test]
    fn application_menu_template_rejects_root_items() {
        assert!(decode_template(
            Some(json!({
                "template": {
                    "items": [{ "type": "item", "id": "open", "label": "Open" }]
                }
            })),
            host_protocol::MENU_SET_APPLICATION_MENU_METHOD,
        )
        .is_err());
    }
}

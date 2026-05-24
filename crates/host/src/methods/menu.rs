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

pub(crate) fn clear(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    validate_clear_payload(payload)?;
    handler.clear_application_menu()?;
    Ok(None)
}

pub(crate) fn capability(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::MENU_CAPABILITY_METHOD)?;
    validate_capability_payload(&payload)?;

    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .expect("capability name is validated above");
    let platform = payload
        .get("platform")
        .and_then(Value::as_str)
        .unwrap_or(CURRENT_PLATFORM);
    let supported = capability_supported(name, platform);
    Ok(Some(serde_json::json!({ "supported": supported })))
}

#[cfg(target_os = "macos")]
const CURRENT_PLATFORM: &str = "macos";
#[cfg(target_os = "windows")]
const CURRENT_PLATFORM: &str = "windows";
#[cfg(target_os = "linux")]
const CURRENT_PLATFORM: &str = "linux";
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
const CURRENT_PLATFORM: &str = "unknown";

fn capability_supported(name: &str, platform: &str) -> bool {
    match (name, platform) {
        ("application menu" | "window menu", "macos" | "windows" | "linux") => true,
        ("command binding", "macos") => true,
        ("command binding", "windows" | "linux") => false,
        _ => false,
    }
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

fn validate_clear_payload(payload: Option<Value>) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Object(ref object)) if object.is_empty() => Ok(()),
        Some(payload) => validate_window_id(&payload, host_protocol::MENU_CLEAR_METHOD),
    }
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
        && operation == host_protocol::MENU_SET_APPLICATION_MENU_METHOD
    {
        return Err(HostProtocolError::invalid_argument(
            "template.items",
            "application menu root items must be submenus",
            operation,
        ));
    }

    for item in items {
        validate_template_entry(item, operation)?;
    }

    Ok(())
}

fn validate_template_entry(value: &Value, operation: &str) -> Result<(), HostProtocolError> {
    match value.get("type").and_then(Value::as_str) {
        Some("item") => {
            validate_printable_value(
                "item.id",
                required_item_string(value, "item", "id", operation)?,
                operation,
            )?;
            validate_printable_value(
                "item.label",
                required_item_string(value, "item", "label", operation)?,
                operation,
            )?;
            if let Some(command_id) = value.get("commandId") {
                let command_id = command_id.as_str().ok_or_else(|| {
                    HostProtocolError::invalid_argument(
                        "item.commandId",
                        "must be a string",
                        operation,
                    )
                })?;
                validate_printable_value("item.commandId", command_id, operation)?;
            }
            if let Some(accelerator) = value.get("accelerator") {
                let accelerator = accelerator.as_str().ok_or_else(|| {
                    HostProtocolError::invalid_argument(
                        "item.accelerator",
                        "must be a string",
                        operation,
                    )
                })?;
                validate_printable_value("item.accelerator", accelerator, operation)?;
            }
            Ok(())
        }
        Some("separator") => Ok(()),
        Some("submenu") => {
            validate_printable_value(
                "submenu.id",
                required_item_string(value, "submenu", "id", operation)?,
                operation,
            )?;
            validate_printable_value(
                "submenu.label",
                required_item_string(value, "submenu", "label", operation)?,
                operation,
            )?;
            let Some(items) = value.get("items").and_then(Value::as_array) else {
                return Err(HostProtocolError::invalid_argument(
                    "submenu.items",
                    "must be an array",
                    operation,
                ));
            };
            for item in items {
                validate_template_entry(item, operation)?;
            }
            Ok(())
        }
        _ => Err(HostProtocolError::invalid_argument(
            "item.type",
            "must be item, separator, or submenu",
            operation,
        )),
    }
}

fn required_item_string<'a>(
    value: &'a Value,
    prefix: &'static str,
    field: &'static str,
    operation: &str,
) -> Result<&'a str, HostProtocolError> {
    value.get(field).and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(
            format!("{prefix}.{field}"),
            "must be a string",
            operation,
        )
    })
}

fn validate_capability_payload(payload: &Value) -> Result<(), HostProtocolError> {
    let name = payload.get("name").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "name",
            "must be a string",
            host_protocol::MENU_CAPABILITY_METHOD,
        )
    })?;
    if !matches!(name, "application menu" | "window menu" | "command binding") {
        return Err(HostProtocolError::invalid_argument(
            "name",
            "must be a known Menu capability",
            host_protocol::MENU_CAPABILITY_METHOD,
        ));
    }
    match payload.get("platform") {
        None => Ok(()),
        Some(Value::String(platform))
            if matches!(platform.as_str(), "macos" | "windows" | "linux") =>
        {
            Ok(())
        }
        Some(_) => Err(HostProtocolError::invalid_argument(
            "platform",
            "must be macos, windows, or linux",
            host_protocol::MENU_CAPABILITY_METHOD,
        )),
    }
}

fn validate_window_id(payload: &Value, operation: &str) -> Result<(), HostProtocolError> {
    let window = payload
        .get("window")
        .and_then(|window| window.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument("window.id", "must be a string", operation)
        })?;
    validate_printable_value("window.id", window, operation)
}

fn validate_printable_value(
    field: &str,
    value: &str,
    operation: &str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ));
    }
    if value.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f)) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
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
    use super::{capability, decode_template, validate_clear_payload, validate_template};
    use host_protocol::HostProtocolError;
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

    #[test]
    fn window_menu_template_accepts_root_items_and_separators() {
        let template = json!({
            "items": [
                { "type": "item", "id": "open", "label": "Open" },
                { "type": "separator" },
                {
                    "type": "submenu",
                    "id": "view",
                    "label": "View",
                    "items": [{ "type": "item", "id": "reload", "label": "Reload" }]
                }
            ]
        });

        assert!(validate_template(&template, host_protocol::MENU_SET_WINDOW_MENU_METHOD).is_ok());
    }

    #[test]
    fn menu_capability_reports_supported_menu_kinds() {
        let app_menu = capability(Some(json!({
            "name": "application menu",
            "platform": "macos"
        })))
        .expect("application menu capability should report support");
        assert_eq!(app_menu, Some(json!({ "supported": true })));

        let window_menu = capability(Some(json!({
            "name": "window menu",
            "platform": "macos"
        })))
        .expect("window menu capability should report support");
        assert_eq!(window_menu, Some(json!({ "supported": true })));
    }

    #[test]
    fn menu_capability_reports_command_binding_platform_support() {
        let binding = capability(Some(json!({
            "name": "command binding",
            "platform": "macos"
        })))
        .expect("command binding capability should report macOS support");
        assert_eq!(binding, Some(json!({ "supported": true })));

        let linux_binding = capability(Some(json!({
            "name": "command binding",
            "platform": "linux"
        })))
        .expect("command binding capability should report Linux unsupported");
        assert_eq!(linux_binding, Some(json!({ "supported": false })));
    }

    #[test]
    fn menu_capability_rejects_unknown_capability_name() {
        assert!(matches!(
            capability(Some(json!({ "name": "no-such-capability" }))),
            Err(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn menu_capability_rejects_unknown_platform() {
        assert!(matches!(
            capability(Some(json!({
                "name": "application menu",
                "platform": "wasm"
            }))),
            Err(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn menu_clear_rejects_invalid_window_payload() {
        let result = validate_clear_payload(Some(json!({ "window": { "id": "" } })));

        assert!(matches!(
            result,
            Err(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn menu_clear_accepts_empty_payload() {
        assert!(validate_clear_payload(None).is_ok());
        assert!(validate_clear_payload(Some(json!({}))).is_ok());
    }

    #[test]
    fn unsupported_menu_methods_reject_invalid_payloads_before_unsupported() {
        assert!(matches!(
            capability(Some(json!({ "name": "unknown" }))),
            Err(HostProtocolError::InvalidArgument { .. })
        ));
    }
}

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

pub(crate) fn clear(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    validate_clear_payload(payload)?;
    platform_clear()?;
    Ok(None)
}

#[cfg(all(target_os = "macos", not(test)))]
fn platform_clear() -> Result<(), HostProtocolError> {
    crate::macos::clear_application_menu()
}

#[cfg(any(not(target_os = "macos"), test))]
fn platform_clear() -> Result<(), HostProtocolError> {
    test_clear_application_menu().unwrap_or_else(|| {
        Err(HostProtocolError::unsupported(
            "Menu.clear is only implemented on macOS in the host adapter",
            host_protocol::MENU_CLEAR_METHOD,
        ))
    })
}

#[cfg(any(not(target_os = "macos"), test))]
fn test_clear_application_menu() -> Option<Result<(), HostProtocolError>> {
    #[cfg(test)]
    {
        tests::TEST_MENU_CLEAR_CALLS.with(|state| {
            let mut state = state.borrow_mut();
            let counter = state.as_mut()?;
            *counter += 1;
            Some(Ok(()))
        })
    }
    #[cfg(not(test))]
    {
        None
    }
}

pub(crate) fn bind_command(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::MENU_BIND_COMMAND_METHOD)?;
    validate_command_binding(&payload, host_protocol::MENU_BIND_COMMAND_METHOD)?;

    Err(unsupported(host_protocol::MENU_BIND_COMMAND_METHOD))
}

pub(crate) fn capability(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::MENU_CAPABILITY_METHOD)?;
    validate_capability_payload(&payload)?;

    Err(unsupported(host_protocol::MENU_CAPABILITY_METHOD))
}

pub(crate) fn show_context_menu(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::CONTEXT_MENU_SHOW_METHOD)?;
    validate_window_id(&payload, host_protocol::CONTEXT_MENU_SHOW_METHOD)?;
    let template = payload.get("template").ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "template",
            "is required",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        )
    })?;
    validate_any_menu_template(template, host_protocol::CONTEXT_MENU_SHOW_METHOD)?;
    validate_position(&payload)?;

    Err(unsupported(host_protocol::CONTEXT_MENU_SHOW_METHOD))
}

pub(crate) fn build_context_menu_from_template(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_payload(
        payload,
        host_protocol::CONTEXT_MENU_BUILD_FROM_TEMPLATE_METHOD,
    )?;
    let template = payload.get("template").ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "template",
            "is required",
            host_protocol::CONTEXT_MENU_BUILD_FROM_TEMPLATE_METHOD,
        )
    })?;
    validate_any_menu_template(
        template,
        host_protocol::CONTEXT_MENU_BUILD_FROM_TEMPLATE_METHOD,
    )?;

    Err(unsupported(
        host_protocol::CONTEXT_MENU_BUILD_FROM_TEMPLATE_METHOD,
    ))
}

pub(crate) fn bind_context_menu_command(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::CONTEXT_MENU_BIND_COMMAND_METHOD)?;
    validate_command_binding(&payload, host_protocol::CONTEXT_MENU_BIND_COMMAND_METHOD)?;

    Err(unsupported(host_protocol::CONTEXT_MENU_BIND_COMMAND_METHOD))
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
    {
        return Err(HostProtocolError::invalid_argument(
            "template.items",
            "application menu root items must be submenus",
            operation,
        ));
    }

    Ok(())
}

fn validate_any_menu_template(template: &Value, operation: &str) -> Result<(), HostProtocolError> {
    if template.get("items").and_then(Value::as_array).is_none() {
        return Err(HostProtocolError::invalid_argument(
            "template.items",
            "must be an array",
            operation,
        ));
    }
    Ok(())
}

fn validate_command_binding(payload: &Value, operation: &str) -> Result<(), HostProtocolError> {
    validate_printable_field(payload, "itemId", operation)?;
    validate_printable_field(payload, "commandId", operation)?;
    Ok(())
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

fn validate_position(payload: &Value) -> Result<(), HostProtocolError> {
    let Some(position) = payload.get("position") else {
        return Err(HostProtocolError::invalid_argument(
            "position",
            "is required",
            host_protocol::CONTEXT_MENU_SHOW_METHOD,
        ));
    };
    for field in ["x", "y"] {
        let Some(value) = position.get(field).and_then(Value::as_f64) else {
            return Err(HostProtocolError::invalid_argument(
                format!("position.{field}"),
                "must be a finite non-negative number",
                host_protocol::CONTEXT_MENU_SHOW_METHOD,
            ));
        };
        if !value.is_finite() || value < 0.0 {
            return Err(HostProtocolError::invalid_argument(
                format!("position.{field}"),
                "must be a finite non-negative number",
                host_protocol::CONTEXT_MENU_SHOW_METHOD,
            ));
        }
    }
    Ok(())
}

fn validate_printable_field(
    payload: &Value,
    field: &'static str,
    operation: &str,
) -> Result<(), HostProtocolError> {
    let value = payload
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "must be a string", operation))?;
    validate_printable_value(field, value, operation)
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

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::MENU_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{
        bind_command, build_context_menu_from_template, capability, clear, decode_template,
        show_context_menu,
    };
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::cell::RefCell;

    thread_local! {
        pub(super) static TEST_MENU_CLEAR_CALLS: RefCell<Option<u32>> = const { RefCell::new(None) };
    }

    fn with_menu_clear_recording<R>(f: impl FnOnce() -> R) -> (R, u32) {
        TEST_MENU_CLEAR_CALLS.with(|state| {
            *state.borrow_mut() = Some(0);
        });
        let result = f();
        let calls = TEST_MENU_CLEAR_CALLS.with(|state| {
            state
                .borrow_mut()
                .take()
                .expect("test menu clear recorder was reset")
        });
        (result, calls)
    }

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
    fn unsupported_menu_methods_validate_payloads_first() {
        assert!(matches!(
            bind_command(Some(
                json!({ "itemId": "file.open", "commandId": "app.open" })
            )),
            Err(HostProtocolError::Unsupported { .. })
        ));
        assert!(matches!(
            capability(Some(
                json!({ "name": "command binding", "platform": "macos" })
            )),
            Err(HostProtocolError::Unsupported { .. })
        ));
    }

    #[test]
    fn menu_clear_rejects_unexpected_payload_before_macos_clear() {
        let (result, calls) = with_menu_clear_recording(|| {
            clear(Some(json!({ "window": { "id": "" } })))
        });

        assert!(matches!(
            result,
            Err(HostProtocolError::InvalidArgument { .. })
        ));
        assert_eq!(calls, 0, "validation must precede the macOS clear path");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn menu_clear_routes_to_macos_when_supported() {
        let (result, calls) = with_menu_clear_recording(|| clear(None));

        assert!(matches!(result, Ok(None)), "clear should succeed on macOS");
        assert_eq!(calls, 1, "clear must invoke the macOS application-menu path");
    }

    #[test]
    fn unsupported_context_menu_methods_validate_payloads_first() {
        let template = json!({ "items": [{ "type": "item", "id": "open", "label": "Open" }] });
        assert!(matches!(
            show_context_menu(Some(json!({
                "window": { "id": "window-1" },
                "template": template,
                "position": { "x": 1.0, "y": 2.0 }
            }))),
            Err(HostProtocolError::Unsupported { .. })
        ));
        assert!(matches!(
            build_context_menu_from_template(Some(json!({
                "template": { "items": [] }
            }))),
            Err(HostProtocolError::Unsupported { .. })
        ));
    }

    #[test]
    fn unsupported_menu_methods_reject_invalid_payloads_before_unsupported() {
        assert!(matches!(
            bind_command(Some(json!({ "itemId": "bad\n", "commandId": "app.open" }))),
            Err(HostProtocolError::InvalidArgument { .. })
        ));
        assert!(matches!(
            capability(Some(json!({ "name": "unknown" }))),
            Err(HostProtocolError::InvalidArgument { .. })
        ));
        assert!(matches!(
            show_context_menu(Some(json!({
                "window": { "id": "window-1" },
                "template": { "items": [] },
                "position": { "x": -1, "y": 2 }
            }))),
            Err(HostProtocolError::InvalidArgument { .. })
        ));
    }
}

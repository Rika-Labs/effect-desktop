#![allow(clippy::result_large_err)]

use host_protocol::{
    HostProtocolError, TransientWindowRoleActorPayload, TransientWindowRoleHandlePayload,
    TransientWindowRoleOpenPayload, TransientWindowRolePlacementKind,
    TransientWindowRolePlacementPayload, TransientWindowRoleRepositionPayload,
    TransientWindowRoleSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn open(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransientWindowRoleOpenPayload>(
        payload,
        host_protocol::TRANSIENT_WINDOW_ROLE_OPEN_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::TRANSIENT_WINDOW_ROLE_OPEN_METHOD,
    )?;
    validate_non_empty(
        "roleId",
        input.role_id(),
        host_protocol::TRANSIENT_WINDOW_ROLE_OPEN_METHOD,
    )?;
    validate_optional(
        "traceId",
        input.trace_id(),
        host_protocol::TRANSIENT_WINDOW_ROLE_OPEN_METHOD,
    )?;
    validate_placement(
        input.policy().placement(),
        host_protocol::TRANSIENT_WINDOW_ROLE_OPEN_METHOD,
    )?;
    Err(unsupported(
        host_protocol::TRANSIENT_WINDOW_ROLE_OPEN_METHOD,
    ))
}

pub(crate) fn reposition(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransientWindowRoleRepositionPayload>(
        payload,
        host_protocol::TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD,
    )?;
    validate_handle(
        input.handle(),
        host_protocol::TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD,
    )?;
    validate_placement(
        input.placement(),
        host_protocol::TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD,
    )?;
    validate_optional(
        "traceId",
        input.trace_id(),
        host_protocol::TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD,
    )?;
    Err(unsupported(
        host_protocol::TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD,
    ))
}

pub(crate) fn dismiss(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransientWindowRoleHandlePayload>(
        payload,
        host_protocol::TRANSIENT_WINDOW_ROLE_DISMISS_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::TRANSIENT_WINDOW_ROLE_DISMISS_METHOD,
    )?;
    validate_handle(
        input.handle(),
        host_protocol::TRANSIENT_WINDOW_ROLE_DISMISS_METHOD,
    )?;
    validate_optional(
        "traceId",
        input.trace_id(),
        host_protocol::TRANSIENT_WINDOW_ROLE_DISMISS_METHOD,
    )?;
    Err(unsupported(
        host_protocol::TRANSIENT_WINDOW_ROLE_DISMISS_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        TransientWindowRoleSupportedPayload::unsupported(
            host_protocol::TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON,
        ),
        host_protocol::TRANSIENT_WINDOW_ROLE_IS_SUPPORTED_METHOD,
    )
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
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode transient window role payload: {error}"),
            operation,
        )
    })
}

fn validate_actor(
    actor: &TransientWindowRoleActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_handle(
    handle: &host_protocol::TransientWindowRoleResourcePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("handle.id", handle.id(), operation)?;
    validate_non_empty("handle.ownerScope", handle.owner_scope(), operation)?;
    if handle.kind() != "transient-window-role" {
        return Err(HostProtocolError::invalid_argument(
            "handle.kind",
            "must be transient-window-role",
            operation,
        ));
    }
    if handle.state() != "open" {
        return Err(HostProtocolError::invalid_argument(
            "handle.state",
            "must be open",
            operation,
        ));
    }
    Ok(())
}

fn validate_placement(
    placement: &TransientWindowRolePlacementPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match placement.kind() {
        TransientWindowRolePlacementKind::Centered => {
            reject_present(
                "placement.ownerWindowId",
                placement.owner_window_id(),
                operation,
            )?;
            reject_present("placement.displayId", placement.display_id(), operation)?;
            reject_point(placement.point_payload(), operation)
        }
        TransientWindowRolePlacementKind::Point => {
            reject_present(
                "placement.ownerWindowId",
                placement.owner_window_id(),
                operation,
            )?;
            reject_present("placement.displayId", placement.display_id(), operation)?;
            let point = placement.point_payload().ok_or_else(|| {
                HostProtocolError::invalid_argument("placement.point", "is required", operation)
            })?;
            let (x, y) = point.values();
            if !x.is_finite() || !y.is_finite() {
                return Err(HostProtocolError::invalid_argument(
                    "placement.point",
                    "coordinates must be finite",
                    operation,
                ));
            }
            Ok(())
        }
        TransientWindowRolePlacementKind::OwnerRelative => {
            validate_required(
                "placement.ownerWindowId",
                placement.owner_window_id(),
                operation,
            )?;
            reject_present("placement.displayId", placement.display_id(), operation)?;
            reject_point(placement.point_payload(), operation)
        }
        TransientWindowRolePlacementKind::DisplayRelative => {
            validate_required("placement.displayId", placement.display_id(), operation)?;
            reject_present(
                "placement.ownerWindowId",
                placement.owner_window_id(),
                operation,
            )?;
            reject_point(placement.point_payload(), operation)
        }
    }
}

fn validate_required(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let value = value
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "is required", operation))?;
    validate_non_empty(field, value, operation)
}

fn reject_present(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_some() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be present for this placement kind",
            operation,
        ));
    }
    Ok(())
}

fn reject_point(
    value: Option<&host_protocol::TransientWindowRolePointPayload>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_some() {
        return Err(HostProtocolError::invalid_argument(
            "placement.point",
            "must not be present for this placement kind",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(value) = value {
        validate_non_empty(field, value, operation)?;
    }
    Ok(())
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_no_nul(field, value, operation)?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_printable_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_no_nul(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn open_validates_before_returning_unsupported() {
        let error = open(Some(open_request())).expect_err("host adapter is not implemented");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn open_rejects_invalid_placement_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "roleId": "palette-1",
            "policy": {
                "role": "palette",
                "focus": "take-focus",
                "dismissal": "escape",
                "zOrder": "floating",
                "placement": { "kind": "point" },
                "restoration": "restore-focus"
            }
        });

        let error = open(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn reposition_rejects_control_byte_actor_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace\n1" },
            "handle": handle(),
            "placement": { "kind": "centered" }
        });

        let error = reposition(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn dismiss_validates_handle_before_unsupported() {
        let error = dismiss(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "handle": handle()
        })))
        .expect_err("host adapter is not implemented");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn dismiss_rejects_forged_handle_before_unsupported() {
        let error = dismiss(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "handle": {
                "kind": "window",
                "id": "palette-1",
                "generation": 0,
                "ownerScope": "workspace:workspace-1",
                "state": "open"
            }
        })))
        .expect_err("invalid handle should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn is_supported_reports_unimplemented_adapter() {
        let payload = is_supported()
            .expect("support response should encode")
            .expect("support response should include payload");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON
            })
        );
    }

    fn open_request() -> serde_json::Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "roleId": "palette-1",
            "policy": {
                "role": "palette",
                "focus": "take-focus",
                "dismissal": "escape",
                "zOrder": "floating",
                "placement": {
                    "kind": "point",
                    "point": { "x": 20.0, "y": 40.0 }
                },
                "restoration": "restore-focus"
            },
            "traceId": "trace-transient-window-role"
        })
    }

    fn handle() -> serde_json::Value {
        json!({
            "kind": "transient-window-role",
            "id": "palette-1",
            "generation": 0,
            "ownerScope": "workspace:workspace-1",
            "state": "open"
        })
    }
}

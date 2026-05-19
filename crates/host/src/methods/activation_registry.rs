#![allow(clippy::result_large_err)]

use host_protocol::{
    ActivationRegistryActorPayload, ActivationRegistryResourcePayload,
    ActivationRegistrySupportedPayload, ActivationRegistrySurfaceListPayload,
    ActivationRegistrySurfacePayload, ActivationRegistrySurfaceRequestPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::{
    collections::BTreeMap,
    sync::{LazyLock, Mutex},
};

static ACTIVATION_SURFACES: LazyLock<Mutex<BTreeMap<String, ActivationRegistrySurfacePayload>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

pub(crate) fn register_surface(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ActivationRegistrySurfacePayload>(
        payload,
        host_protocol::ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD,
    )?;
    validate_surface(
        &input,
        host_protocol::ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD,
    )?;

    let surface_id = input.surface_id().to_string();
    let owner_scope = input
        .owner_scope()
        .map(str::to_string)
        .unwrap_or_else(|| format!("activation-surface:{surface_id}"));
    let mut surfaces =
        activation_surfaces(host_protocol::ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD)?;
    if surfaces.contains_key(&surface_id) {
        return Err(HostProtocolError::invalid_argument(
            "surfaceId",
            "surface is already registered",
            host_protocol::ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD,
        ));
    }
    surfaces.insert(surface_id.clone(), input);

    encode_payload(
        ActivationRegistryResourcePayload::new(surface_id, 0, owner_scope),
        host_protocol::ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD,
    )
}

pub(crate) fn unregister_surface(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ActivationRegistrySurfaceRequestPayload>(
        payload,
        host_protocol::ACTIVATION_REGISTRY_UNREGISTER_SURFACE_METHOD,
    )?;
    validate_bridge_safe_non_empty(
        "surfaceId",
        input.surface_id(),
        host_protocol::ACTIVATION_REGISTRY_UNREGISTER_SURFACE_METHOD,
    )?;
    validate_optional(
        "traceId",
        input.trace_id(),
        host_protocol::ACTIVATION_REGISTRY_UNREGISTER_SURFACE_METHOD,
    )?;
    let mut surfaces =
        activation_surfaces(host_protocol::ACTIVATION_REGISTRY_UNREGISTER_SURFACE_METHOD)?;
    if surfaces.remove(input.surface_id()).is_none() {
        return Err(HostProtocolError::not_found(
            format!("ActivationSurface:{}", input.surface_id()),
            host_protocol::ACTIVATION_REGISTRY_UNREGISTER_SURFACE_METHOD,
        ));
    }

    Ok(None)
}

pub(crate) fn list_surfaces() -> Result<Option<Value>, HostProtocolError> {
    let surfaces = activation_surfaces(host_protocol::ACTIVATION_REGISTRY_LIST_SURFACES_METHOD)?;
    encode_payload(
        ActivationRegistrySurfaceListPayload::new(surfaces.values().cloned().collect()),
        host_protocol::ACTIVATION_REGISTRY_LIST_SURFACES_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ActivationRegistrySupportedPayload::supported(),
        host_protocol::ACTIVATION_REGISTRY_IS_SUPPORTED_METHOD,
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
            format!("failed to encode activation registry payload: {error}"),
            operation,
        )
    })
}

fn validate_surface(
    input: &ActivationRegistrySurfacePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_bridge_safe_non_empty("surfaceId", input.surface_id(), operation)?;
    validate_printable_non_empty("commandId", input.command_id(), operation)?;
    validate_actor(input.actor(), operation)?;
    validate_optional("ownerScope", input.owner_scope(), operation)?;
    validate_optional("traceId", input.trace_id(), operation)
}

fn validate_actor(
    actor: &ActivationRegistryActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_optional(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(value) = value {
        validate_bridge_safe_non_empty(field, value, operation)?;
    }
    Ok(())
}

fn validate_bridge_safe_non_empty(
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
    if value.is_empty() {
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
    validate_bridge_safe_non_empty(field, value, operation)?;
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn activation_surfaces(
    operation: &'static str,
) -> Result<
    std::sync::MutexGuard<'static, BTreeMap<String, ActivationRegistrySurfacePayload>>,
    HostProtocolError,
> {
    ACTIVATION_SURFACES.lock().map_err(|_| {
        HostProtocolError::internal("activation registry surface table is poisoned", operation)
    })
}

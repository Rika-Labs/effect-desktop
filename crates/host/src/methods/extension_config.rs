#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    ExtensionConfigActorPayload, ExtensionConfigFieldPayload, ExtensionConfigReadPayload,
    ExtensionConfigRedactPayload, ExtensionConfigResetPayload, ExtensionConfigSupportedPayload,
    ExtensionConfigValueEntryPayload, ExtensionConfigValueType, ExtensionConfigWritePayload,
    HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::collections::BTreeSet;

pub(crate) fn read(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExtensionConfigReadPayload>(
        payload,
        host_protocol::EXTENSION_CONFIG_READ_METHOD,
    )?;
    validate_read(&input, host_protocol::EXTENSION_CONFIG_READ_METHOD)?;
    Err(unsupported(host_protocol::EXTENSION_CONFIG_READ_METHOD))
}

pub(crate) fn write(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExtensionConfigWritePayload>(
        payload,
        host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
    )?;
    validate_write(&input, host_protocol::EXTENSION_CONFIG_WRITE_METHOD)?;
    Err(unsupported(host_protocol::EXTENSION_CONFIG_WRITE_METHOD))
}

pub(crate) fn reset(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExtensionConfigResetPayload>(
        payload,
        host_protocol::EXTENSION_CONFIG_RESET_METHOD,
    )?;
    validate_reset(&input, host_protocol::EXTENSION_CONFIG_RESET_METHOD)?;
    Err(unsupported(host_protocol::EXTENSION_CONFIG_RESET_METHOD))
}

pub(crate) fn redact(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExtensionConfigRedactPayload>(
        payload,
        host_protocol::EXTENSION_CONFIG_REDACT_METHOD,
    )?;
    validate_read(&input, host_protocol::EXTENSION_CONFIG_REDACT_METHOD)?;
    Err(unsupported(host_protocol::EXTENSION_CONFIG_REDACT_METHOD))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ExtensionConfigSupportedPayload::unsupported(
            host_protocol::EXTENSION_CONFIG_UNSUPPORTED_REASON,
        ),
        host_protocol::EXTENSION_CONFIG_IS_SUPPORTED_METHOD,
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
            format!("failed to encode extension config payload: {error}"),
            operation,
        )
    })
}

fn validate_read(
    input: &ExtensionConfigReadPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_name("extensionId", input.extension_id(), operation)?;
    validate_fields(input.fields(), operation)
}

fn validate_write(
    input: &ExtensionConfigWritePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_name("extensionId", input.extension_id(), operation)?;
    validate_fields(input.fields(), operation)?;
    let field_keys = field_keys(input.fields());
    let secret_keys = secret_keys(input.fields());
    let mut values = BTreeSet::new();
    for entry in input.values() {
        validate_value_entry(entry, input.fields(), &field_keys, &mut values, operation)?;
    }
    let mut seen_secrets = BTreeSet::new();
    for key in input.secret_keys() {
        if !secret_keys.contains(key.as_str()) {
            return Err(HostProtocolError::invalid_argument(
                "secretKeys",
                "must reference declared secret fields",
                operation,
            ));
        }
        if !seen_secrets.insert(key.as_str()) {
            return Err(HostProtocolError::invalid_argument(
                "secretKeys",
                "must be unique",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_reset(
    input: &ExtensionConfigResetPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_name("extensionId", input.extension_id(), operation)?;
    validate_fields(input.fields(), operation)?;
    let field_keys = field_keys(input.fields());
    for key in input.keys() {
        if !field_keys.contains(key.as_str()) {
            return Err(HostProtocolError::invalid_argument(
                "keys",
                "must reference declared fields",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_actor(
    actor: &ExtensionConfigActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_name("actor.id", actor.id(), operation)
}

fn validate_fields(
    fields: &[ExtensionConfigFieldPayload],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if fields.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "fields",
            "must include at least one field",
            operation,
        ));
    }
    let mut keys = BTreeSet::new();
    for field in fields {
        validate_name("fields.key", field.key(), operation)?;
        if !keys.insert(field.key()) {
            return Err(HostProtocolError::invalid_argument(
                "fields.key",
                "must be unique",
                operation,
            ));
        }
        if field.secret() && field.default_value().is_some() {
            return Err(HostProtocolError::invalid_argument(
                "fields.defaultValue",
                "secret fields cannot declare defaults",
                operation,
            ));
        }
        if let Some(default_value) = field.default_value() {
            validate_value_type(
                field.value_type(),
                default_value,
                "fields.defaultValue",
                operation,
            )?;
        }
    }
    Ok(())
}

fn validate_value_entry<'a>(
    entry: &'a ExtensionConfigValueEntryPayload,
    fields: &'a [ExtensionConfigFieldPayload],
    field_keys: &BTreeSet<&'a str>,
    seen: &mut BTreeSet<&'a str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !field_keys.contains(entry.key()) {
        return Err(HostProtocolError::invalid_argument(
            "values.key",
            "must reference a declared field",
            operation,
        ));
    }
    if !seen.insert(entry.key()) {
        return Err(HostProtocolError::invalid_argument(
            "values.key",
            "must be unique",
            operation,
        ));
    }
    let field = fields
        .iter()
        .find(|field| field.key() == entry.key())
        .expect("field key was checked above");
    if field.secret() {
        return Err(HostProtocolError::invalid_argument(
            "values.key",
            "secret fields must be written as secrets",
            operation,
        ));
    }
    validate_value_type(field.value_type(), entry.value(), "values.value", operation)
}

fn validate_value_type(
    value_type: ExtensionConfigValueType,
    value: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let valid = match value_type {
        ExtensionConfigValueType::String => value.is_string(),
        ExtensionConfigValueType::Number => value.is_number(),
        ExtensionConfigValueType::Boolean => value.is_boolean(),
        ExtensionConfigValueType::Json => true,
    };
    if valid {
        Ok(())
    } else {
        Err(HostProtocolError::invalid_argument(
            field,
            "does not match declared field type",
            operation,
        ))
    }
}

fn field_keys(fields: &[ExtensionConfigFieldPayload]) -> BTreeSet<&str> {
    fields
        .iter()
        .map(ExtensionConfigFieldPayload::key)
        .collect()
}

fn secret_keys(fields: &[ExtensionConfigFieldPayload]) -> BTreeSet<&str> {
    fields
        .iter()
        .filter(|field| field.secret())
        .map(ExtensionConfigFieldPayload::key)
        .collect()
}

fn validate_name(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    if !value
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must contain only letters, numbers, dots, underscores, or dashes",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::EXTENSION_CONFIG_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{is_supported, read, reset, write};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn read_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = read(Some(valid_read_payload())).expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::EXTENSION_CONFIG_UNSUPPORTED_REASON,
                host_protocol::EXTENSION_CONFIG_READ_METHOD,
            )
        );
    }

    #[test]
    fn write_rejects_mismatched_value_type_before_unsupported() {
        let error = write(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": [{ "key": "enabled", "valueType": "boolean", "secret": false }],
            "values": [{ "key": "enabled", "value": "yes" }]
        })))
        .expect_err("invalid value must fail before unsupported");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "values.value",
                "does not match declared field type",
                host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
            )
        );
    }

    #[test]
    fn write_rejects_secret_values_on_non_secret_path() {
        let error = write(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": [{ "key": "apiKey", "valueType": "string", "secret": true }],
            "values": [{ "key": "apiKey", "value": "redacted" }]
        })))
        .expect_err("secret fields must not be written as plain values");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "values.key",
                "secret fields must be written as secrets",
                host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
            )
        );
    }

    #[test]
    fn reset_rejects_unknown_keys_before_unsupported() {
        let error = reset(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": [{ "key": "theme", "valueType": "string", "secret": false }],
            "keys": ["missing"]
        })))
        .expect_err("unknown reset key must fail before unsupported");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "keys",
                "must reference declared fields",
                host_protocol::EXTENSION_CONFIG_RESET_METHOD,
            )
        );
    }

    #[test]
    fn is_supported_returns_typed_unsupported_status() {
        let payload = is_supported().expect("support payload should encode");

        assert_eq!(
            payload,
            Some(json!({
                "supported": false,
                "reason": host_protocol::EXTENSION_CONFIG_UNSUPPORTED_REASON
            }))
        );
    }

    fn valid_read_payload() -> serde_json::Value {
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": [
                {
                    "key": "theme",
                    "valueType": "string",
                    "secret": false,
                    "defaultValue": "light"
                },
                { "key": "apiKey", "valueType": "string", "secret": true }
            ],
            "traceId": "trace-read"
        })
    }
}

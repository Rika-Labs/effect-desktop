#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    AssociationFileAssociationsPayload, AssociationProtocolPayload, HostProtocolError,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

const RESERVED_SCHEMES: &[&str] = &[
    "about",
    "app",
    "blob",
    "data",
    "file",
    "http",
    "https",
    "javascript",
    "vbscript",
    "chrome",
    "view-source",
];

pub(crate) fn is_default_protocol_client(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AssociationProtocolPayload>(
        payload,
        host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
    )?;
    validate_scheme(
        input.scheme(),
        host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
    )?;
    Err(unsupported(
        host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
    ))
}

pub(crate) fn set_default_protocol_client(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AssociationProtocolPayload>(
        payload,
        host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
    )?;
    validate_scheme(
        input.scheme(),
        host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
    )?;
    Err(unsupported(
        host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
    ))
}

pub(crate) fn get_file_associations(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(
        payload.as_ref(),
        "extensions",
        host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
    )?;
    let input = decode_payload::<AssociationFileAssociationsPayload>(
        payload,
        host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
    )?;
    if let Some(extensions) = input.extensions() {
        for extension in extensions {
            validate_extension(
                extension,
                host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
            )?;
        }
    }
    Err(unsupported(
        host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
    ))
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

fn reject_null_field(
    payload: Option<&Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if matches!(
        payload
            .and_then(Value::as_object)
            .and_then(|object| object.get(field)),
        Some(Value::Null)
    ) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be omitted instead of null",
            operation,
        ));
    }
    Ok(())
}

fn validate_scheme(scheme: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if scheme.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must be non-empty",
            operation,
        ));
    }
    let mut chars = scheme.chars();
    let Some(first) = chars.next() else {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must be non-empty",
            operation,
        ));
    };
    if !first.is_ascii_lowercase()
        || !chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || "+.-".contains(ch))
    {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must match ^[a-z][a-z0-9+.-]*$",
            operation,
        ));
    }
    if RESERVED_SCHEMES.contains(&scheme) {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "is reserved",
            operation,
        ));
    }
    Ok(())
}

fn validate_extension(extension: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if !extension.starts_with('.') || extension.len() < 2 {
        return Err(HostProtocolError::invalid_argument(
            "extensions",
            "entries must start with a dot and include a name",
            operation,
        ));
    }
    if !extension
        .chars()
        .nth(1)
        .is_some_and(|ch| ch.is_ascii_alphanumeric())
    {
        return Err(HostProtocolError::invalid_argument(
            "extensions",
            "entries must start with a dot followed by an ASCII letter or digit",
            operation,
        ));
    }
    if extension.contains("..") {
        return Err(HostProtocolError::invalid_argument(
            "extensions",
            "entries must not contain traversal segments",
            operation,
        ));
    }
    if extension
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')))
    {
        return Err(HostProtocolError::invalid_argument(
            "extensions",
            "entries must contain only ASCII letters, digits, dot, underscore, or hyphen",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::ASSOCIATION_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{get_file_associations, is_default_protocol_client, set_default_protocol_client};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn association_requests_decode_before_unsupported() {
        assert_eq!(
            is_default_protocol_client(Some(json!({ "scheme": "example" }))).expect_err("status"),
            HostProtocolError::unsupported(
                host_protocol::ASSOCIATION_UNSUPPORTED_REASON,
                host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
            )
        );
        assert_eq!(
            set_default_protocol_client(Some(json!({ "scheme": "example" })))
                .expect_err("set default"),
            HostProtocolError::unsupported(
                host_protocol::ASSOCIATION_UNSUPPORTED_REASON,
                host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
            )
        );
        assert_eq!(
            get_file_associations(Some(json!({ "extensions": [".txt"] })))
                .expect_err("file associations"),
            HostProtocolError::unsupported(
                host_protocol::ASSOCIATION_UNSUPPORTED_REASON,
                host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
            )
        );
    }

    #[test]
    fn association_requests_reject_invalid_inputs_before_unsupported() {
        assert_eq!(
            is_default_protocol_client(Some(json!({ "scheme": "https" })))
                .expect_err("reserved scheme")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            is_default_protocol_client(Some(json!({ "scheme": "vbscript" })))
                .expect_err("dangerous scheme")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            get_file_associations(Some(json!({ "extensions": null }))).expect_err("null"),
            HostProtocolError::invalid_argument(
                "extensions",
                "must be omitted instead of null",
                host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
            )
        );
        assert_eq!(
            get_file_associations(Some(json!({ "extensions": ["../txt"] })))
                .expect_err("bad extension")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            get_file_associations(Some(json!({ "extensions": [".-"] })))
                .expect_err("bad extension start")
                .tag(),
            "InvalidArgument"
        );
    }
}

#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use std::collections::BTreeSet;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use host_protocol::{
    HostProtocolError, SafeStorageKeyPayload, SafeStorageListResultPayload, SafeStorageSetPayload,
};
use keyring::{Entry, Error as KeyringError};
use serde_json::{json, Value};

const SAFE_STORAGE_SERVICE: &str = "effect-desktop.safe-storage";
const SAFE_STORAGE_INDEX_SERVICE: &str = "effect-desktop.safe-storage.index";
const SAFE_STORAGE_INDEX_KEY: &str = "keys";
#[cfg(not(test))]
const SAFE_STORAGE_PROBE_KEY: &str = "__effect_desktop_probe__";
const SAFE_STORAGE_UNAVAILABLE_REASON: &str = "secure-storage-unavailable";

trait SafeStorageBackend {
    fn set(&self, key: &str, value: &str, operation: &'static str)
        -> Result<(), HostProtocolError>;
    fn get(&self, key: &str, operation: &'static str) -> Result<String, HostProtocolError>;
    fn delete(&self, key: &str, operation: &'static str) -> Result<(), HostProtocolError>;
    fn list(&self, operation: &'static str) -> Result<Vec<String>, HostProtocolError>;
    fn is_available(&self) -> bool;
}

struct KeyringSafeStorageBackend;

impl SafeStorageBackend for KeyringSafeStorageBackend {
    fn set(
        &self,
        key: &str,
        value: &str,
        operation: &'static str,
    ) -> Result<(), HostProtocolError> {
        let entry = keyring_entry(SAFE_STORAGE_SERVICE, key, operation)?;
        entry
            .set_password(value)
            .map_err(|error| map_keyring_error(error, key, operation))?;
        if let Err(error) = add_index_key(key, operation) {
            let _ = entry.delete_credential();
            return Err(error);
        }
        Ok(())
    }

    fn get(&self, key: &str, operation: &'static str) -> Result<String, HostProtocolError> {
        keyring_entry(SAFE_STORAGE_SERVICE, key, operation)?
            .get_password()
            .map_err(|error| map_keyring_error(error, key, operation))
    }

    fn delete(&self, key: &str, operation: &'static str) -> Result<(), HostProtocolError> {
        let entry = keyring_entry(SAFE_STORAGE_SERVICE, key, operation)?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {}
            Err(error) => return Err(map_keyring_error(error, key, operation)),
        }
        remove_index_key(key, operation)
    }

    fn list(&self, operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
        read_index(operation)
    }

    fn is_available(&self) -> bool {
        #[cfg(test)]
        {
            false
        }

        #[cfg(not(test))]
        {
            let Ok(entry) = Entry::new(SAFE_STORAGE_SERVICE, SAFE_STORAGE_PROBE_KEY) else {
                return false;
            };
            if entry.set_password("probe").is_err() {
                return false;
            }
            let _ = entry.delete_credential();
            true
        }
    }
}

pub(crate) fn set(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    set_with_backend(&KeyringSafeStorageBackend, payload)
}

pub(crate) fn get(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    get_with_backend(&KeyringSafeStorageBackend, payload)
}

pub(crate) fn delete(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    delete_with_backend(&KeyringSafeStorageBackend, payload)
}

pub(crate) fn list(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    list_with_backend(&KeyringSafeStorageBackend, payload)
}

pub(crate) fn is_available() -> Result<Option<Value>, HostProtocolError> {
    Ok(Some(json!({
        "available": KeyringSafeStorageBackend.is_available()
    })))
}

fn set_with_backend(
    backend: &impl SafeStorageBackend,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_set_payload(payload)?;
    validate_key(payload.key(), host_protocol::SAFE_STORAGE_SET_METHOD)?;
    validate_secret_value(payload.value(), host_protocol::SAFE_STORAGE_SET_METHOD)?;
    backend.set(
        payload.key(),
        payload.value(),
        host_protocol::SAFE_STORAGE_SET_METHOD,
    )?;
    Ok(None)
}

fn get_with_backend(
    backend: &impl SafeStorageBackend,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_key_payload(payload, host_protocol::SAFE_STORAGE_GET_METHOD)?;
    validate_key(payload.key(), host_protocol::SAFE_STORAGE_GET_METHOD)?;
    let value = backend.get(payload.key(), host_protocol::SAFE_STORAGE_GET_METHOD)?;
    validate_secret_value(&value, host_protocol::SAFE_STORAGE_GET_METHOD)?;
    Ok(Some(json!({ "value": value })))
}

fn delete_with_backend(
    backend: &impl SafeStorageBackend,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_key_payload(payload, host_protocol::SAFE_STORAGE_DELETE_METHOD)?;
    validate_key(payload.key(), host_protocol::SAFE_STORAGE_DELETE_METHOD)?;
    backend.delete(payload.key(), host_protocol::SAFE_STORAGE_DELETE_METHOD)?;
    Ok(None)
}

fn list_with_backend(
    backend: &impl SafeStorageBackend,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    validate_void_payload(payload, host_protocol::SAFE_STORAGE_LIST_METHOD)?;
    let keys = backend.list(host_protocol::SAFE_STORAGE_LIST_METHOD)?;
    for key in &keys {
        validate_key(key, host_protocol::SAFE_STORAGE_LIST_METHOD)?;
    }
    Ok(Some(
        serde_json::to_value(SafeStorageListResultPayload::new(keys)).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode safe storage list payload: {error}"),
                host_protocol::SAFE_STORAGE_LIST_METHOD,
            )
        })?,
    ))
}

fn decode_set_payload(payload: Option<Value>) -> Result<SafeStorageSetPayload, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::SAFE_STORAGE_SET_METHOD)?;
    serde_json::from_value::<SafeStorageSetPayload>(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::SAFE_STORAGE_SET_METHOD,
        )
    })
}

fn decode_key_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<SafeStorageKeyPayload, HostProtocolError> {
    let payload = required_payload(payload, operation)?;
    serde_json::from_value::<SafeStorageKeyPayload>(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn validate_key(key: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if key.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "key",
            "must not be empty",
            operation,
        ));
    }
    if key.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f)) {
        return Err(HostProtocolError::invalid_argument(
            "key",
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_secret_value(value: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    BASE64_STANDARD.decode(value).map(|_| ()).map_err(|_| {
        HostProtocolError::invalid_argument(
            "value",
            "must be base64-encoded secret bytes",
            operation,
        )
    })
}

fn validate_void_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted or null",
            operation,
        )),
    }
}

fn required_payload(payload: Option<Value>, operation: &str) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

fn keyring_entry(
    service: &'static str,
    key: &str,
    operation: &'static str,
) -> Result<Entry, HostProtocolError> {
    Entry::new(service, key).map_err(|error| map_keyring_error(error, key, operation))
}

fn index_entry(operation: &'static str) -> Result<Entry, HostProtocolError> {
    keyring_entry(
        SAFE_STORAGE_INDEX_SERVICE,
        SAFE_STORAGE_INDEX_KEY,
        operation,
    )
}

fn read_index(operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
    let entry = index_entry(operation)?;
    let source = match entry.get_password() {
        Ok(source) => source,
        Err(KeyringError::NoEntry) => return Ok(Vec::new()),
        Err(error) => return Err(map_keyring_error(error, SAFE_STORAGE_INDEX_KEY, operation)),
    };
    let keys = serde_json::from_str::<Vec<String>>(&source).map_err(|error| {
        HostProtocolError::invalid_output(
            operation,
            format!("safe storage index payload is invalid: {error}"),
        )
    })?;
    Ok(keys)
}

fn write_index(keys: BTreeSet<String>, operation: &'static str) -> Result<(), HostProtocolError> {
    let entry = index_entry(operation)?;
    if keys.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(map_keyring_error(error, SAFE_STORAGE_INDEX_KEY, operation)),
        };
    }
    let source = serde_json::to_string(&keys.into_iter().collect::<Vec<_>>()).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode safe storage index: {error}"),
            operation,
        )
    })?;
    entry
        .set_password(&source)
        .map_err(|error| map_keyring_error(error, SAFE_STORAGE_INDEX_KEY, operation))
}

fn add_index_key(key: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    let mut keys = read_index(operation)?
        .into_iter()
        .collect::<BTreeSet<String>>();
    keys.insert(key.to_string());
    write_index(keys, operation)
}

fn remove_index_key(key: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    let mut keys = read_index(operation)?
        .into_iter()
        .collect::<BTreeSet<String>>();
    keys.remove(key);
    write_index(keys, operation)
}

fn map_keyring_error(error: KeyringError, key: &str, operation: &'static str) -> HostProtocolError {
    match error {
        KeyringError::NoEntry => HostProtocolError::not_found(key, operation),
        KeyringError::NoStorageAccess(_) | KeyringError::PlatformFailure(_) => {
            HostProtocolError::unsupported(SAFE_STORAGE_UNAVAILABLE_REASON, operation)
        }
        KeyringError::TooLong(attribute, _) => {
            HostProtocolError::invalid_argument(attribute, "exceeds platform limit", operation)
        }
        KeyringError::Invalid(attribute, reason) => {
            HostProtocolError::invalid_argument(attribute, reason, operation)
        }
        KeyringError::BadEncoding(_) => {
            HostProtocolError::invalid_output(operation, "stored secret value is not UTF-8")
        }
        KeyringError::Ambiguous(_) => {
            HostProtocolError::internal("safe storage key matched multiple credentials", operation)
        }
        _ => HostProtocolError::internal("safe storage backend failed", operation),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_key_payload, decode_set_payload, delete_with_backend, get_with_backend,
        list_with_backend, set_with_backend, validate_key, SafeStorageBackend,
    };
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::{collections::BTreeMap, sync::Mutex};

    #[derive(Default)]
    struct MemorySafeStorageBackend {
        values: Mutex<BTreeMap<String, String>>,
    }

    impl SafeStorageBackend for MemorySafeStorageBackend {
        fn set(
            &self,
            key: &str,
            value: &str,
            _operation: &'static str,
        ) -> Result<(), HostProtocolError> {
            self.values
                .lock()
                .expect("safe storage test backend should lock")
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn get(&self, key: &str, operation: &'static str) -> Result<String, HostProtocolError> {
            self.values
                .lock()
                .expect("safe storage test backend should lock")
                .get(key)
                .cloned()
                .ok_or_else(|| HostProtocolError::not_found(key, operation))
        }

        fn delete(&self, key: &str, _operation: &'static str) -> Result<(), HostProtocolError> {
            self.values
                .lock()
                .expect("safe storage test backend should lock")
                .remove(key);
            Ok(())
        }

        fn list(&self, _operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
            Ok(self
                .values
                .lock()
                .expect("safe storage test backend should lock")
                .keys()
                .cloned()
                .collect())
        }

        fn is_available(&self) -> bool {
            true
        }
    }

    #[test]
    fn safe_storage_round_trips_secret_values_without_exposing_secret_in_errors() {
        let backend = MemorySafeStorageBackend::default();
        set_with_backend(&backend, Some(json!({ "key": "token", "value": "AAE=" })))
            .expect("set should store secret");

        let get = get_with_backend(&backend, Some(json!({ "key": "token" })))
            .expect("get should read secret");
        assert_eq!(get, Some(json!({ "value": "AAE=" })));

        let list = list_with_backend(&backend, None).expect("list should return keys");
        assert_eq!(list, Some(json!({ "keys": ["token"] })));

        delete_with_backend(&backend, Some(json!({ "key": "token" })))
            .expect("delete should remove secret");
        let after_delete = get_with_backend(&backend, Some(json!({ "key": "token" })))
            .expect_err("deleted secret should be missing");
        assert!(!format!("{after_delete:?}").contains("AAE="));
    }

    #[test]
    fn set_payload_rejects_invalid_secret_encoding_before_backend_work() {
        let backend = MemorySafeStorageBackend::default();
        let error = set_with_backend(
            &backend,
            Some(json!({ "key": "token", "value": "not base64" })),
        )
        .expect_err("invalid secret encoding should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
        assert_eq!(
            backend
                .values
                .lock()
                .expect("safe storage test backend should lock")
                .len(),
            0
        );
    }

    #[test]
    fn set_payload_validates_shape_without_exposing_secret_value() {
        let payload =
            decode_set_payload(Some(json!({ "key": "token", "value": "AAE=" }))).expect("payload");
        assert_eq!(payload.key(), "token");
        assert_eq!(payload.value(), "AAE=");

        let error = validate_key("", host_protocol::SAFE_STORAGE_SET_METHOD)
            .expect_err("empty key should fail");
        assert!(!format!("{error:?}").contains("AAE="));
    }

    #[test]
    fn set_payload_rejects_excess_fields_before_backend_work() {
        assert!(decode_set_payload(Some(json!({
            "key": "token",
            "value": "AAE=",
            "unexpected": true
        })))
        .is_err());
    }

    #[test]
    fn key_payload_rejects_invalid_shape_and_keys() {
        assert!(decode_key_payload(
            Some(json!({ "key": "token", "unexpected": true })),
            host_protocol::SAFE_STORAGE_GET_METHOD,
        )
        .is_err());
        assert!(validate_key("bad\nkey", host_protocol::SAFE_STORAGE_GET_METHOD).is_err());
    }

    #[test]
    fn list_rejects_non_void_payload_before_backend_work() {
        let backend = MemorySafeStorageBackend::default();
        let error =
            list_with_backend(&backend, Some(json!({}))).expect_err("object payload should reject");
        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }
}

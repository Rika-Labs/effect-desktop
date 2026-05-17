#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    ExtensionConfigActorPayload, ExtensionConfigEventPayload, ExtensionConfigEventPhase,
    ExtensionConfigExportPolicy, ExtensionConfigFieldPayload, ExtensionConfigReadPayload,
    ExtensionConfigReadResultPayload, ExtensionConfigRedactPayload,
    ExtensionConfigRedactResultPayload, ExtensionConfigRedactionEvidencePayload,
    ExtensionConfigResetPayload, ExtensionConfigResetResultPayload,
    ExtensionConfigSecretStatePayload, ExtensionConfigSupportedPayload,
    ExtensionConfigValueEntryPayload, ExtensionConfigValueType, ExtensionConfigWritePayload,
    ExtensionConfigWriteResultPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{to_value, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
#[cfg(unix)]
use std::os::fd::AsRawFd;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
#[cfg(windows)]
use windows_sys::Win32::Foundation::HANDLE;
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{LockFileEx, UnlockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
#[cfg(windows)]
use windows_sys::Win32::System::IO::OVERLAPPED;

const STORE_ENV: &str = "EFFECT_DESKTOP_EXTENSION_CONFIG_STORE";
const STORE_DIR: &str = "effect-desktop";
const STORE_FILE: &str = "extension-config.json";
const STORE_UNAVAILABLE_REASON: &str = "extension-config-store-unavailable";
const REDACTED_SECRET_VALUE: &str = "<redacted:ExtensionConfigSecret>";
const REDACTED_PRIVATE_VALUE: &str = "<redacted:ExtensionConfigPrivate>";

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) static EXTENSION_CONFIG_ENV_LOCK: Mutex<()> = Mutex::new(());

pub(crate) type EventfulResponse = Result<(Option<Value>, Option<Value>), HostProtocolError>;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfigStore {
    #[serde(default)]
    extensions: BTreeMap<String, ExtensionRecord>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtensionRecord {
    #[serde(default)]
    values: BTreeMap<String, Value>,
    #[serde(default)]
    secret_keys: BTreeSet<String>,
    revision: u64,
}

#[cfg(test)]
pub(crate) fn read(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    read_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn read_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<ExtensionConfigReadPayload>(
        payload,
        host_protocol::EXTENSION_CONFIG_READ_METHOD,
    )?;
    validate_read(&input, host_protocol::EXTENSION_CONFIG_READ_METHOD)?;
    let response = read_record(&input, host_protocol::EXTENSION_CONFIG_READ_METHOD)?;
    let event = config_event(
        timestamp,
        input.extension_id(),
        ExtensionConfigEventPhase::Read,
        field_keys_vec(input.fields()),
        Some(response.revision),
        host_protocol::EXTENSION_CONFIG_READ_METHOD,
    )?;
    encode_payload(
        ExtensionConfigReadResultPayload::new(
            input.extension_id(),
            response.values,
            response.secrets,
            response.revision,
        ),
        host_protocol::EXTENSION_CONFIG_READ_METHOD,
    )
    .map(|payload| (payload, event))
}

#[cfg(test)]
pub(crate) fn write(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    write_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn write_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<ExtensionConfigWritePayload>(
        payload,
        host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
    )?;
    validate_write(&input, host_protocol::EXTENSION_CONFIG_WRITE_METHOD)?;
    let result = update_store(host_protocol::EXTENSION_CONFIG_WRITE_METHOD, |store| {
        let record = store
            .extensions
            .entry(input.extension_id().to_string())
            .or_default();
        for entry in input.values() {
            record
                .values
                .insert(entry.key().to_string(), entry.value().clone());
        }
        for key in input.secret_keys() {
            record.secret_keys.insert(key.clone());
        }
        record.revision = record.revision.saturating_add(1);
        (written_keys(&input), record.revision)
    })?;
    let (written_keys, revision) = result;
    let event = config_event(
        timestamp,
        input.extension_id(),
        ExtensionConfigEventPhase::Written,
        written_keys.clone(),
        Some(revision),
        host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
    )?;
    encode_payload(
        ExtensionConfigWriteResultPayload::new(input.extension_id(), written_keys, revision),
        host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
    )
    .map(|payload| (payload, event))
}

#[cfg(test)]
pub(crate) fn reset(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reset_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn reset_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<ExtensionConfigResetPayload>(
        payload,
        host_protocol::EXTENSION_CONFIG_RESET_METHOD,
    )?;
    validate_reset(&input, host_protocol::EXTENSION_CONFIG_RESET_METHOD)?;
    let reset_keys = if input.keys().is_empty() {
        field_keys_vec(input.fields())
    } else {
        input.keys().to_vec()
    };
    let revision = update_store(host_protocol::EXTENSION_CONFIG_RESET_METHOD, |store| {
        let record = store
            .extensions
            .entry(input.extension_id().to_string())
            .or_default();
        for key in &reset_keys {
            record.values.remove(key);
            record.secret_keys.remove(key);
        }
        record.revision = record.revision.saturating_add(1);
        record.revision
    })?;
    let event = config_event(
        timestamp,
        input.extension_id(),
        ExtensionConfigEventPhase::Reset,
        reset_keys.clone(),
        Some(revision),
        host_protocol::EXTENSION_CONFIG_RESET_METHOD,
    )?;
    encode_payload(
        ExtensionConfigResetResultPayload::new(input.extension_id(), reset_keys, revision),
        host_protocol::EXTENSION_CONFIG_RESET_METHOD,
    )
    .map(|payload| (payload, event))
}

#[cfg(test)]
pub(crate) fn redact(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    redact_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn redact_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<ExtensionConfigRedactPayload>(
        payload,
        host_protocol::EXTENSION_CONFIG_REDACT_METHOD,
    )?;
    validate_read(&input, host_protocol::EXTENSION_CONFIG_REDACT_METHOD)?;
    let result = read_store(host_protocol::EXTENSION_CONFIG_REDACT_METHOD, |store| {
        let record = store
            .extensions
            .get(input.extension_id())
            .cloned()
            .unwrap_or_default();
        redact_record(input.extension_id(), input.fields(), &record)
    })?;
    let event = config_event(
        timestamp,
        input.extension_id(),
        ExtensionConfigEventPhase::Redacted,
        field_keys_vec(input.fields()),
        None,
        host_protocol::EXTENSION_CONFIG_REDACT_METHOD,
    )?;
    encode_payload(result, host_protocol::EXTENSION_CONFIG_REDACT_METHOD)
        .map(|payload| (payload, event))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    let payload = match ensure_store_available(host_protocol::EXTENSION_CONFIG_IS_SUPPORTED_METHOD)
    {
        Ok(()) => ExtensionConfigSupportedPayload::supported(),
        Err(_) => ExtensionConfigSupportedPayload::unsupported(STORE_UNAVAILABLE_REASON),
    };
    encode_payload(payload, host_protocol::EXTENSION_CONFIG_IS_SUPPORTED_METHOD)
}

struct ReadRecord {
    values: Vec<ExtensionConfigValueEntryPayload>,
    secrets: Vec<ExtensionConfigSecretStatePayload>,
    revision: u64,
}

fn read_record(
    input: &ExtensionConfigReadPayload,
    operation: &'static str,
) -> Result<ReadRecord, HostProtocolError> {
    read_store(operation, |store| {
        let record = store
            .extensions
            .get(input.extension_id())
            .cloned()
            .unwrap_or_default();
        let values = input
            .fields()
            .iter()
            .filter(|field| !field.secret())
            .filter_map(|field| {
                record
                    .values
                    .get(field.key())
                    .or_else(|| field.default_value())
                    .map(|value| ExtensionConfigValueEntryPayload::new(field.key(), value.clone()))
            })
            .collect();
        let secrets = input
            .fields()
            .iter()
            .filter(|field| field.secret())
            .map(|field| {
                ExtensionConfigSecretStatePayload::new(
                    field.key(),
                    record.secret_keys.contains(field.key()),
                )
            })
            .collect();
        ReadRecord {
            values,
            secrets,
            revision: record.revision,
        }
    })
}

fn redact_record(
    extension_id: &str,
    fields: &[ExtensionConfigFieldPayload],
    record: &ExtensionRecord,
) -> ExtensionConfigRedactResultPayload {
    let mut values = Vec::new();
    let mut redactions = Vec::new();
    for field in fields {
        if field.secret() {
            values.push(ExtensionConfigValueEntryPayload::new(
                field.key(),
                Value::String(REDACTED_SECRET_VALUE.to_string()),
            ));
            redactions.push(ExtensionConfigRedactionEvidencePayload::new(
                field.key(),
                "secret-field",
            ));
            continue;
        }
        if matches!(
            field.export_policy(),
            Some(ExtensionConfigExportPolicy::Private)
        ) {
            values.push(ExtensionConfigValueEntryPayload::new(
                field.key(),
                Value::String(REDACTED_PRIVATE_VALUE.to_string()),
            ));
            redactions.push(ExtensionConfigRedactionEvidencePayload::new(
                field.key(),
                "private-export",
            ));
            continue;
        }
        if let Some(value) = record
            .values
            .get(field.key())
            .or_else(|| field.default_value())
        {
            values.push(ExtensionConfigValueEntryPayload::new(
                field.key(),
                value.clone(),
            ));
        }
    }
    ExtensionConfigRedactResultPayload::new(extension_id, values, redactions)
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

fn config_event(
    timestamp: u64,
    extension_id: &str,
    phase: ExtensionConfigEventPhase,
    keys: Vec<String>,
    revision: Option<u64>,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ExtensionConfigEventPayload::new(timestamp, extension_id, phase, keys, revision, None),
        operation,
    )
}

fn read_store<T>(
    operation: &'static str,
    read: impl FnOnce(&ConfigStore) -> T,
) -> Result<T, HostProtocolError> {
    let _guard = STORE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("extension config store lock poisoned", operation)
    })?;
    let path = store_path(operation)?;
    let _store_lock = lock_store_file(&path, operation)?;
    let store = load_store(&path, operation)?;
    Ok(read(&store))
}

fn update_store<T>(
    operation: &'static str,
    update: impl FnOnce(&mut ConfigStore) -> T,
) -> Result<T, HostProtocolError> {
    let _guard = STORE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("extension config store lock poisoned", operation)
    })?;
    let path = store_path(operation)?;
    let _store_lock = lock_store_file(&path, operation)?;
    let mut store = load_store(&path, operation)?;
    let result = update(&mut store);
    save_store(&path, &store, operation)?;
    Ok(result)
}

fn ensure_store_available(operation: &'static str) -> Result<(), HostProtocolError> {
    let _guard = STORE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("extension config store lock poisoned", operation)
    })?;
    let path = store_path(operation)?;
    let _store_lock = lock_store_file(&path, operation)?;
    let store = load_store(&path, operation)?;
    save_store(&path, &store, operation)
}

fn load_store(path: &Path, operation: &'static str) -> Result<ConfigStore, HostProtocolError> {
    if !path.exists() {
        return Ok(ConfigStore::default());
    }
    let body = fs::read_to_string(path).map_err(|error| store_error("read", error, operation))?;
    if body.trim().is_empty() {
        return Ok(ConfigStore::default());
    }
    serde_json::from_str(&body).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to decode extension config store: {error}"),
            operation,
        )
    })
}

fn save_store(
    path: &Path,
    store: &ConfigStore,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    ensure_parent(path, operation)?;
    let body = serde_json::to_vec_pretty(store).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode extension config store: {error}"),
            operation,
        )
    })?;
    let temp_path = temp_store_path(path);
    fs::write(&temp_path, body).map_err(|error| store_error("write", error, operation))?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        store_error("replace", error, operation)
    })?;
    Ok(())
}

fn ensure_parent(path: &Path, operation: &'static str) -> Result<(), HostProtocolError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| store_error("create directory", error, operation))?;
    }
    Ok(())
}

fn temp_store_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(STORE_FILE);
    path.with_file_name(format!("{file_name}.{}.tmp", uuid::Uuid::new_v4()))
}

fn store_lock_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(STORE_FILE);
    path.with_file_name(format!("{file_name}.lock"))
}

fn lock_store_file(
    path: &Path,
    operation: &'static str,
) -> Result<StoreFileLockGuard, HostProtocolError> {
    let lock_path = store_lock_path(path);
    ensure_parent(&lock_path, operation)?;
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .map_err(|error| store_error("open lock file for", error, operation))?;
    lock_file_exclusive(file, operation)
}

#[cfg(unix)]
struct StoreFileLockGuard {
    file: File,
}

#[cfg(unix)]
fn lock_file_exclusive(
    file: File,
    operation: &'static str,
) -> Result<StoreFileLockGuard, HostProtocolError> {
    let status = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    if status == 0 {
        return Ok(StoreFileLockGuard { file });
    }

    Err(HostProtocolError::internal(
        format!(
            "failed to lock extension config store: {}",
            std::io::Error::last_os_error()
        ),
        operation,
    ))
}

#[cfg(unix)]
impl Drop for StoreFileLockGuard {
    fn drop(&mut self) {
        let _ = unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
    }
}

#[cfg(windows)]
struct StoreFileLockGuard {
    file: File,
    overlapped: OVERLAPPED,
}

#[cfg(windows)]
fn lock_file_exclusive(
    file: File,
    operation: &'static str,
) -> Result<StoreFileLockGuard, HostProtocolError> {
    let mut overlapped = unsafe { std::mem::zeroed::<OVERLAPPED>() };
    let handle = file.as_raw_handle() as HANDLE;
    let status = unsafe {
        LockFileEx(
            handle,
            LOCKFILE_EXCLUSIVE_LOCK,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    };
    if status != 0 {
        return Ok(StoreFileLockGuard { file, overlapped });
    }

    Err(HostProtocolError::internal(
        format!(
            "failed to lock extension config store: {}",
            std::io::Error::last_os_error()
        ),
        operation,
    ))
}

#[cfg(windows)]
impl Drop for StoreFileLockGuard {
    fn drop(&mut self) {
        let handle = self.file.as_raw_handle() as HANDLE;
        let _ = unsafe { UnlockFileEx(handle, 0, u32::MAX, u32::MAX, &mut self.overlapped) };
    }
}

fn store_error(
    action: &'static str,
    error: std::io::Error,
    operation: &'static str,
) -> HostProtocolError {
    HostProtocolError::internal(
        format!("failed to {action} extension config store: {error}"),
        operation,
    )
}

fn store_path(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if let Some(path) = std::env::var_os(STORE_ENV).map(PathBuf::from) {
        return Ok(path);
    }
    default_store_path()
        .ok_or_else(|| HostProtocolError::unsupported(STORE_UNAVAILABLE_REASON, operation))
}

#[cfg(target_os = "macos")]
fn default_store_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).map(|home| {
        home.join("Library")
            .join("Application Support")
            .join(STORE_DIR)
            .join(STORE_FILE)
    })
}

#[cfg(target_os = "windows")]
fn default_store_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .map(|data| data.join(STORE_DIR).join(STORE_FILE))
}

#[cfg(target_os = "linux")]
fn default_store_path() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".config"))
        })
        .map(|config| config.join(STORE_DIR).join(STORE_FILE))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn default_store_path() -> Option<PathBuf> {
    None
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

fn field_keys_vec(fields: &[ExtensionConfigFieldPayload]) -> Vec<String> {
    fields.iter().map(|field| field.key().to_string()).collect()
}

fn written_keys(input: &ExtensionConfigWritePayload) -> Vec<String> {
    input
        .values()
        .iter()
        .map(|entry| entry.key().to_string())
        .chain(input.secret_keys().iter().cloned())
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

#[cfg(test)]
mod tests {
    use super::{
        is_supported, read, redact, reset, write, ConfigStore, STORE_ENV, STORE_UNAVAILABLE_REASON,
    };
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn write_persists_non_secret_values_and_secret_presence() {
        with_temp_store("write-read", || {
            let write_payload = write(Some(json!({
                "actor": { "kind": "extension", "id": "extension-1" },
                "extensionId": "extension-1",
                "fields": valid_fields(),
                "values": [{ "key": "theme", "value": "dark" }],
                "secretKeys": ["apiKey"]
            })))
            .expect("write should succeed");

            assert_eq!(
                write_payload,
                Some(json!({
                    "extensionId": "extension-1",
                    "writtenKeys": ["theme", "apiKey"],
                    "revision": 1
                }))
            );

            let read_payload = read(Some(valid_read_payload())).expect("read should succeed");

            assert_eq!(
                read_payload,
                Some(json!({
                    "extensionId": "extension-1",
                    "values": [
                        { "key": "theme", "value": "dark" },
                        { "key": "volume", "value": 0.75 }
                    ],
                    "secrets": [{ "key": "apiKey", "present": true }],
                    "revision": 1
                }))
            );
        });
    }

    #[test]
    fn store_file_never_contains_secret_bytes() {
        with_temp_store("secret-presence", || {
            let store_path = PathBuf::from(std::env::var_os(STORE_ENV).expect("store path set"));
            write(Some(json!({
                "actor": { "kind": "extension", "id": "extension-1" },
                "extensionId": "extension-1",
                "fields": valid_fields(),
                "secretKeys": ["apiKey"]
            })))
            .expect("write should succeed");

            let stored = fs::read_to_string(store_path).expect("store should be readable");
            assert!(stored.contains("apiKey"));
            assert!(!stored.contains("secret-value"));
            assert!(!stored.contains("redacted"));
        });
    }

    #[test]
    fn reset_selected_keys_removes_values_and_secret_presence() {
        with_temp_store("reset", || {
            write(Some(json!({
                "actor": { "kind": "extension", "id": "extension-1" },
                "extensionId": "extension-1",
                "fields": valid_fields(),
                "values": [
                    { "key": "theme", "value": "dark" },
                    { "key": "volume", "value": 1 }
                ],
                "secretKeys": ["apiKey"]
            })))
            .expect("write should succeed");

            let reset_payload = reset(Some(json!({
                "actor": { "kind": "extension", "id": "extension-1" },
                "extensionId": "extension-1",
                "fields": valid_fields(),
                "keys": ["theme", "apiKey"]
            })))
            .expect("reset should succeed");

            assert_eq!(
                reset_payload,
                Some(json!({
                    "extensionId": "extension-1",
                    "resetKeys": ["theme", "apiKey"],
                    "revision": 2
                }))
            );

            assert_eq!(
                read(Some(valid_read_payload())).expect("read should succeed"),
                Some(json!({
                    "extensionId": "extension-1",
                    "values": [
                        { "key": "theme", "value": "light" },
                        { "key": "volume", "value": 1 }
                    ],
                    "secrets": [{ "key": "apiKey", "present": false }],
                    "revision": 2
                }))
            );
        });
    }

    #[test]
    fn redact_exports_diagnostics_values_and_redacts_private_or_secret_fields() {
        with_temp_store("redact", || {
            write(Some(json!({
                "actor": { "kind": "extension", "id": "extension-1" },
                "extensionId": "extension-1",
                "fields": valid_fields(),
                "values": [
                    { "key": "theme", "value": "dark" },
                    { "key": "privateNote", "value": "do-not-export" }
                ],
                "secretKeys": ["apiKey"]
            })))
            .expect("write should succeed");

            let payload = redact(Some(valid_read_payload())).expect("redact should succeed");

            assert_eq!(
                payload,
                Some(json!({
                    "extensionId": "extension-1",
                    "values": [
                        { "key": "theme", "value": "dark" },
                        { "key": "apiKey", "value": "<redacted:ExtensionConfigSecret>" },
                        { "key": "volume", "value": 0.75 },
                        { "key": "privateNote", "value": "<redacted:ExtensionConfigPrivate>" }
                    ],
                    "redactions": [
                        { "key": "apiKey", "reason": "secret-field" },
                        { "key": "privateNote", "reason": "private-export" }
                    ]
                }))
            );
        });
    }

    #[test]
    fn write_rejects_mismatched_value_type_before_persistence() {
        with_temp_store("invalid-type", || {
            let error = write(Some(json!({
                "actor": { "kind": "extension", "id": "extension-1" },
                "extensionId": "extension-1",
                "fields": [{ "key": "enabled", "valueType": "boolean", "secret": false }],
                "values": [{ "key": "enabled", "value": "yes" }]
            })))
            .expect_err("invalid value must fail before persistence");

            assert_eq!(
                error,
                HostProtocolError::invalid_argument(
                    "values.value",
                    "does not match declared field type",
                    host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
                )
            );
        });
    }

    #[test]
    fn write_rejects_secret_values_on_non_secret_path() {
        with_temp_store("secret-value", || {
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
        });
    }

    #[test]
    fn read_rejects_secret_field_defaults_before_persistence() {
        with_temp_store("secret-default", || {
            let error = read(Some(json!({
                "actor": { "kind": "extension", "id": "extension-1" },
                "extensionId": "extension-1",
                "fields": [
                    {
                        "key": "apiKey",
                        "valueType": "string",
                        "secret": true,
                        "defaultValue": "not-allowed"
                    }
                ],
                "traceId": "trace-read"
            })))
            .expect_err("secret defaults should be rejected");

            assert_eq!(
                error,
                HostProtocolError::invalid_argument(
                    "fields.defaultValue",
                    "secret fields cannot declare defaults",
                    host_protocol::EXTENSION_CONFIG_READ_METHOD,
                )
            );
        });
    }

    #[test]
    fn reset_rejects_unknown_keys_before_persistence() {
        with_temp_store("invalid-reset", || {
            let error = reset(Some(json!({
                "actor": { "kind": "extension", "id": "extension-1" },
                "extensionId": "extension-1",
                "fields": [{ "key": "theme", "valueType": "string", "secret": false }],
                "keys": ["missing"]
            })))
            .expect_err("unknown reset key must fail before persistence");

            assert_eq!(
                error,
                HostProtocolError::invalid_argument(
                    "keys",
                    "must reference declared fields",
                    host_protocol::EXTENSION_CONFIG_RESET_METHOD,
                )
            );
        });
    }

    #[test]
    fn is_supported_returns_true_when_store_is_available() {
        with_temp_store("supported", || {
            let payload = is_supported().expect("support payload should encode");

            assert_eq!(payload, Some(json!({ "supported": true })));
        });
    }

    #[test]
    fn is_supported_returns_false_when_store_path_is_not_writable_as_file() {
        let _guard = super::EXTENSION_CONFIG_ENV_LOCK
            .lock()
            .expect("extension config env lock should not be poisoned");
        let dir = unique_temp_dir("unsupported-directory");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let previous = std::env::var_os(STORE_ENV);
        std::env::set_var(STORE_ENV, &dir);

        let payload = is_supported().expect("support payload should encode");

        restore_store_env(previous);
        let _ = fs::remove_dir_all(dir);

        assert_eq!(
            payload,
            Some(json!({
                "supported": false,
                "reason": STORE_UNAVAILABLE_REASON
            }))
        );
    }

    #[test]
    fn invalid_store_json_is_typed_host_failure() {
        with_temp_store("invalid-store", || {
            let store_path = PathBuf::from(std::env::var_os(STORE_ENV).expect("store path set"));
            fs::write(&store_path, "{").expect("invalid store should be written");

            let error = read(Some(valid_read_payload())).expect_err("invalid store should fail");

            assert!(matches!(error, HostProtocolError::Internal { .. }));
        });
    }

    #[test]
    fn empty_store_round_trips_through_json_shape() {
        let store = ConfigStore::default();
        let json = serde_json::to_value(store).expect("store should encode");

        assert_eq!(json, json!({ "extensions": {} }));
    }

    fn valid_read_payload() -> serde_json::Value {
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": valid_fields(),
            "traceId": "trace-read"
        })
    }

    fn valid_fields() -> serde_json::Value {
        json!([
            {
                "key": "theme",
                "valueType": "string",
                "secret": false,
                "defaultValue": "light"
            },
            { "key": "apiKey", "valueType": "string", "secret": true },
            {
                "key": "volume",
                "valueType": "number",
                "secret": false,
                "defaultValue": 0.75
            },
            {
                "key": "privateNote",
                "valueType": "string",
                "secret": false,
                "exportPolicy": "private"
            }
        ])
    }

    fn with_temp_store<T>(name: &str, test: impl FnOnce() -> T) -> T {
        let _guard = super::EXTENSION_CONFIG_ENV_LOCK
            .lock()
            .expect("extension config env lock should not be poisoned");
        let dir = unique_temp_dir(name);
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let store_path = dir.join("extension-config.json");
        let previous = std::env::var_os(STORE_ENV);
        std::env::set_var(STORE_ENV, &store_path);
        let result = test();
        restore_store_env(previous);
        let _ = fs::remove_dir_all(dir);
        result
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("effect-desktop-extension-config-{nanos}-{name}"))
    }

    fn restore_store_env(previous: Option<std::ffi::OsString>) {
        match previous {
            Some(path) => std::env::set_var(STORE_ENV, path),
            None => std::env::remove_var(STORE_ENV),
        }
    }
}

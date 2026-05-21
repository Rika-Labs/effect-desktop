#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, SessionProfileFromPartitionPayload, SessionProfileHandlePayload,
    SessionProfileListPayload, SessionProfileResourcePayload, SessionProfileSupportedPayload,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env,
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

const DEFAULT_OWNER_SCOPE: &str = "app";
const PROFILE_KIND: &str = "session-profile";

static SESSION_PROFILES: LazyLock<Mutex<BTreeMap<String, SessionProfileResourcePayload>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

pub(crate) fn from_partition(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_payload::<SessionProfileFromPartitionPayload>(
        payload,
        host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
    )?;
    validate_bridge_non_empty_string(
        "partition",
        payload.partition(),
        host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
    )?;
    if let Some(owner_scope) = payload.owner_scope() {
        validate_bridge_non_empty_string(
            "ownerScope",
            owner_scope,
            host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
        )?;
    }

    let id = profile_id(payload.partition());
    let owner_scope = payload.owner_scope().unwrap_or(DEFAULT_OWNER_SCOPE);
    let profile = {
        let mut profiles = lock_profiles(host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD)?;
        profiles
            .entry(id.clone())
            .or_insert_with(|| SessionProfileResourcePayload::new(id, 0, owner_scope))
            .clone()
    };

    serde_json::to_value(profile)
        .map(Some)
        .map_err(|error| encode_error(error, host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD))
}

pub(crate) fn destroy(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_payload::<SessionProfileHandlePayload>(
        payload,
        host_protocol::SESSION_PROFILE_DESTROY_METHOD,
    )?;
    validate_profile_handle(
        payload.profile(),
        host_protocol::SESSION_PROFILE_DESTROY_METHOD,
    )?;
    let mut profiles = lock_profiles(host_protocol::SESSION_PROFILE_DESTROY_METHOD)?;
    if profiles.remove(payload.profile().id()).is_none() {
        return Err(HostProtocolError::not_found(
            format!("SessionProfile:{}", payload.profile().id()),
            host_protocol::SESSION_PROFILE_DESTROY_METHOD,
        ));
    }
    Ok(None)
}

pub(crate) fn list(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    if payload.is_some() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            host_protocol::SESSION_PROFILE_LIST_METHOD,
        ));
    }
    let profiles = lock_profiles(host_protocol::SESSION_PROFILE_LIST_METHOD)?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    serde_json::to_value(SessionProfileListPayload::new(profiles))
        .map(Some)
        .map_err(|error| encode_error(error, host_protocol::SESSION_PROFILE_LIST_METHOD))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(SessionProfileSupportedPayload::supported())
        .map(Some)
        .map_err(|error| encode_error(error, host_protocol::SESSION_PROFILE_IS_SUPPORTED_METHOD))
}

pub(crate) fn ensure_profile_is_live(
    profile: &SessionProfileResourcePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_profile_handle(profile, operation)?;
    let profiles = lock_profiles(operation)?;
    if profiles.contains_key(profile.id()) {
        Ok(())
    } else {
        Err(HostProtocolError::not_found(
            format!("SessionProfile:{}", profile.id()),
            operation,
        ))
    }
}

pub(crate) fn profile_data_directory(
    profile: &SessionProfileResourcePayload,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    ensure_profile_is_live(profile, operation)?;
    Ok(session_profile_base_dir(operation)?.join(profile_dir_name(profile.id())))
}

pub(crate) fn profile_data_store_identifier(
    profile: &SessionProfileResourcePayload,
    operation: &'static str,
) -> Result<[u8; 16], HostProtocolError> {
    ensure_profile_is_live(profile, operation)?;
    let digest = profile_digest(profile.id());
    let mut identifier = [0_u8; 16];
    identifier.copy_from_slice(&digest[..16]);
    Ok(identifier)
}

fn lock_profiles(
    operation: &'static str,
) -> Result<
    std::sync::MutexGuard<'static, BTreeMap<String, SessionProfileResourcePayload>>,
    HostProtocolError,
> {
    SESSION_PROFILES.lock().map_err(|_| {
        HostProtocolError::internal("session profile registry mutex poisoned", operation)
    })
}

fn decode_payload<T: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    let Some(payload) = payload else {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "must be an object",
            operation,
        ));
    };
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            format!("invalid payload: {error}"),
            operation,
        )
    })
}

fn validate_profile_handle(
    profile: &SessionProfileResourcePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if profile.kind() != PROFILE_KIND {
        return Err(HostProtocolError::invalid_argument(
            "profile.kind",
            "must be session-profile",
            operation,
        ));
    }
    validate_bridge_non_empty_string("profile.id", profile.id(), operation)?;
    validate_bridge_non_empty_string("profile.ownerScope", profile.owner_scope(), operation)?;
    if profile.generation() != 0 {
        return Err(HostProtocolError::invalid_argument(
            "profile.generation",
            "must match the live SessionProfile generation",
            operation,
        ));
    }
    if profile.state() != "open" {
        return Err(HostProtocolError::invalid_argument(
            "profile.state",
            "must be open",
            operation,
        ));
    }
    Ok(())
}

fn validate_bridge_non_empty_string(
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
    if value.as_bytes().contains(&0) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL bytes",
            operation,
        ));
    }
    Ok(())
}

fn profile_id(partition: &str) -> String {
    format!("session-profile:{partition}")
}

fn profile_dir_name(profile_id: &str) -> String {
    format!("sha256-{}", hex_lower(&profile_digest(profile_id)))
}

fn profile_digest(profile_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(profile_id.as_bytes());
    hasher.finalize().into()
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn session_profile_base_dir(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    let base = if cfg!(target_os = "macos") {
        home_dir(operation)?
            .join("Library")
            .join("Application Support")
            .join("effect-desktop")
    } else if cfg!(target_os = "windows") {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| HostProtocolError::host_unavailable(operation))?
            .join("effect-desktop")
    } else if cfg!(target_os = "linux") {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                home_dir(operation)
                    .ok()
                    .map(|home| home.join(".local").join("share"))
            })
            .ok_or_else(|| HostProtocolError::host_unavailable(operation))?
            .join("effect-desktop")
    } else {
        return Err(HostProtocolError::unsupported(
            "host-session-profile-platform-unavailable",
            operation,
        ));
    };
    Ok(base.join("session-profiles"))
}

fn home_dir(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| HostProtocolError::host_unavailable(operation))
}

fn encode_error(error: serde_json::Error, operation: &'static str) -> HostProtocolError {
    HostProtocolError::internal(
        format!("failed to encode session profile response: {error}"),
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{destroy, from_partition, is_supported, list, profile_dir_name, SESSION_PROFILES};
    use serde_json::json;

    fn reset_profiles() {
        SESSION_PROFILES
            .lock()
            .expect("profiles mutex should lock")
            .clear();
    }

    #[test]
    fn session_profile_support_reports_available_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(response, json!({ "supported": true }));
    }

    #[test]
    fn session_profile_from_partition_is_idempotent_and_listable() {
        reset_profiles();
        let profile = from_partition(Some(json!({
            "partition": "workspace-1",
            "ownerScope": "workspace:1"
        })))
        .expect("profile should create")
        .expect("profile should encode");
        let same_profile = from_partition(Some(json!({
            "partition": "workspace-1",
            "ownerScope": "workspace:1"
        })))
        .expect("profile should resolve")
        .expect("profile should encode");
        let profiles = list(None)
            .expect("profiles should list")
            .expect("profiles should encode");

        assert_eq!(profile, same_profile);
        assert_eq!(
            profile,
            json!({
                "kind": "session-profile",
                "id": "session-profile:workspace-1",
                "generation": 0,
                "ownerScope": "workspace:1",
                "state": "open"
            })
        );
        assert_eq!(profiles, json!({ "profiles": [profile] }));
    }

    #[test]
    fn session_profile_destroy_removes_profile() {
        reset_profiles();
        let profile = from_partition(Some(json!({ "partition": "workspace-1" })))
            .expect("profile should create")
            .expect("profile should encode");
        destroy(Some(json!({ "profile": profile }))).expect("profile should destroy");
        let profiles = list(None)
            .expect("profiles should list")
            .expect("profiles should encode");

        assert_eq!(profiles, json!({ "profiles": [] }));
    }

    #[test]
    fn session_profile_from_partition_rejects_malformed_payload_before_registry_mutation() {
        reset_profiles();
        let error = from_partition(Some(json!({ "partition": "" })))
            .expect_err("blank partition should be rejected by payload decode");

        assert_eq!(error.tag(), "InvalidArgument");
        assert_eq!(
            serde_json::to_value(&error).expect("error should encode")["operation"],
            host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD
        );
        assert!(!SESSION_PROFILES
            .lock()
            .expect("profiles mutex should lock")
            .contains_key("session-profile:"));
    }

    #[test]
    fn session_profile_list_rejects_payload() {
        let error = list(Some(json!({}))).expect_err("list payload should be rejected");

        assert_eq!(error.tag(), "InvalidArgument");
        assert_eq!(
            serde_json::to_value(&error).expect("error should encode")["operation"],
            host_protocol::SESSION_PROFILE_LIST_METHOD
        );
    }

    #[test]
    fn session_profile_data_directory_name_is_stable_and_path_safe() {
        assert_eq!(profile_dir_name("session-profile:workspace-1").len(), 71);
        assert!(profile_dir_name("session-profile:workspace-1").starts_with("sha256-"));
    }
}

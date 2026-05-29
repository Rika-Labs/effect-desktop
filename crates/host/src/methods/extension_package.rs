#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    ExtensionPackageActorPayload, ExtensionPackageEventPayload, ExtensionPackageEventPhase,
    ExtensionPackageInstallPayload, ExtensionPackageInstallResultPayload,
    ExtensionPackageListResultPayload, ExtensionPackageManifestPayload,
    ExtensionPackageRemovePayload, ExtensionPackageRemoveResultPayload, ExtensionPackageSourceKind,
    ExtensionPackageSourcePayload, ExtensionPackageStatePayload, ExtensionPackageSupportedPayload,
    ExtensionPackageUpdatePayload, ExtensionPackageUpdateResultPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{to_value, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::Read;
#[cfg(unix)]
use std::os::fd::AsRawFd;
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
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

const STORE_ENV: &str = "EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE";
const STORE_DIR: &str = "effect-desktop";
const STORE_ROOT: &str = "extension-packages";
const STORE_FILE: &str = "extension-packages.json";
const STORE_LOCK_FILE: &str = "extension-packages.lock";
const PACKAGES_DIR: &str = "packages";
const TEMP_DIR: &str = ".tmp";
const STORE_UNAVAILABLE_REASON: &str = "extension-package-store-unavailable";
const REGISTRY_SOURCE_UNSUPPORTED_REASON: &str = "extension-package-registry-source-unimplemented";
const SHA256_PREFIX: &str = "sha256:";

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) static EXTENSION_PACKAGE_ENV_LOCK: Mutex<()> = Mutex::new(());

pub(crate) type EventfulResponse = Result<(Option<Value>, Option<Value>), HostProtocolError>;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageStore {
    #[serde(default)]
    packages: BTreeMap<String, PackageRecord>,
    revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageRecord {
    manifest: ExtensionPackageManifestPayload,
    source: ExtensionPackageSourcePayload,
    revision: u64,
    content_path: String,
}

#[derive(Clone, Debug)]
struct ResolvedSource {
    path: PathBuf,
    kind: ExtensionPackageSourceKind,
}

#[derive(Clone, Debug)]
struct InstalledContent {
    relative_path: String,
}

#[cfg(test)]
pub(crate) fn install(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    install_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn install_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<ExtensionPackageInstallPayload>(
        payload,
        host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
    )?;
    validate_install(&input, host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD)?;
    let source = resolve_source(
        input.source(),
        host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
    )?;
    let result = install_package(&input, &source)?;
    let event = package_event(
        timestamp,
        input.manifest().id(),
        ExtensionPackageEventPhase::Installed,
        Some(input.manifest().version().to_string()),
        Some(result.revision),
        None,
        host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
    )?;
    encode_payload(
        ExtensionPackageInstallResultPayload::new(
            input.manifest().id(),
            input.manifest().version(),
            result.revision,
            declared_capabilities(input.manifest()),
        ),
        host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
    )
    .map(|payload| (payload, event))
}

#[cfg(test)]
pub(crate) fn update(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    update_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn update_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<ExtensionPackageUpdatePayload>(
        payload,
        host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD,
    )?;
    validate_update(&input, host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD)?;
    let source = resolve_source(
        input.source(),
        host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD,
    )?;
    let result = update_package(&input, &source)?;
    let event = package_event(
        timestamp,
        input.manifest().id(),
        ExtensionPackageEventPhase::Updated,
        Some(input.manifest().version().to_string()),
        Some(result.revision),
        None,
        host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD,
    )?;
    encode_payload(
        ExtensionPackageUpdateResultPayload::new(
            input.manifest().id(),
            result.previous_version,
            input.manifest().version(),
            result.revision,
            declared_capabilities(input.manifest()),
        ),
        host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD,
    )
    .map(|payload| (payload, event))
}

#[cfg(test)]
pub(crate) fn remove(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    remove_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn remove_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<ExtensionPackageRemovePayload>(
        payload,
        host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD,
    )?;
    validate_remove(&input, host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD)?;
    let result = remove_package(&input)?;
    let event = package_event(
        timestamp,
        input.package_id(),
        ExtensionPackageEventPhase::Removed,
        None,
        Some(result.revision),
        None,
        host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD,
    )?;
    encode_payload(
        ExtensionPackageRemoveResultPayload::new(
            input.package_id(),
            result.removed,
            result.revision,
        ),
        host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD,
    )
    .map(|payload| (payload, event))
}

pub(crate) fn list() -> Result<Option<Value>, HostProtocolError> {
    let packages = read_store(host_protocol::EXTENSION_PACKAGE_LIST_METHOD, |store| {
        store
            .packages
            .iter()
            .map(|(package_id, record)| {
                ExtensionPackageStatePayload::new(
                    package_id,
                    record.manifest.clone(),
                    record.source.clone(),
                    record.revision,
                )
            })
            .collect::<Vec<_>>()
    })?;
    encode_payload(
        ExtensionPackageListResultPayload::new(packages),
        host_protocol::EXTENSION_PACKAGE_LIST_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    let payload = match ensure_store_available(host_protocol::EXTENSION_PACKAGE_IS_SUPPORTED_METHOD)
    {
        Ok(()) => ExtensionPackageSupportedPayload::supported(),
        Err(_) => ExtensionPackageSupportedPayload::unsupported(STORE_UNAVAILABLE_REASON),
    };
    encode_payload(
        payload,
        host_protocol::EXTENSION_PACKAGE_IS_SUPPORTED_METHOD,
    )
}

struct InstallResult {
    revision: u64,
}

struct UpdateResult {
    previous_version: Option<String>,
    revision: u64,
}

struct RemoveResult {
    removed: bool,
    revision: u64,
}

fn install_package(
    input: &ExtensionPackageInstallPayload,
    source: &ResolvedSource,
) -> Result<InstallResult, HostProtocolError> {
    let operation = host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD;
    let _guard = STORE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("extension package store lock poisoned", operation)
    })?;
    let root = store_root(operation)?;
    let _store_lock = lock_store_file(&root, operation)?;
    ensure_store_root(&root, operation)?;
    let mut store = load_store(&state_path(&root), operation)?;
    let package_id = input.manifest().id();
    if store.packages.contains_key(package_id) {
        return Err(already_exists(package_id, operation));
    }
    let revision = store.revision.saturating_add(1);
    let content = persist_verified_source(
        &root,
        package_id,
        revision,
        input.manifest(),
        input.source(),
        source,
        operation,
    )?;
    store.revision = revision;
    store.packages.insert(
        package_id.to_string(),
        PackageRecord {
            manifest: input.manifest().clone(),
            source: input.source().clone(),
            revision,
            content_path: content.relative_path.clone(),
        },
    );
    if let Err(error) = save_store(&state_path(&root), &store, operation) {
        let _ = remove_path(&root.join(&content.relative_path), operation);
        return Err(error);
    }
    Ok(InstallResult { revision })
}

fn update_package(
    input: &ExtensionPackageUpdatePayload,
    source: &ResolvedSource,
) -> Result<UpdateResult, HostProtocolError> {
    let operation = host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD;
    let _guard = STORE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("extension package store lock poisoned", operation)
    })?;
    let root = store_root(operation)?;
    let _store_lock = lock_store_file(&root, operation)?;
    ensure_store_root(&root, operation)?;
    let mut store = load_store(&state_path(&root), operation)?;
    let package_id = input.manifest().id();
    let Some(previous) = store.packages.get(package_id).cloned() else {
        return Err(HostProtocolError::not_found(package_id, operation));
    };
    if let Some(expected_version) = input.expected_version() {
        if previous.manifest.version() != expected_version {
            return Err(invalid_state(
                previous.manifest.version(),
                expected_version,
                "expectedVersion does not match installed version",
                operation,
            ));
        }
    }
    let revision = store.revision.saturating_add(1);
    let content = persist_verified_source(
        &root,
        package_id,
        revision,
        input.manifest(),
        input.source(),
        source,
        operation,
    )?;
    let old_tombstone = match tombstone_stored_content(&root, &previous.content_path, operation) {
        Ok(path) => path,
        Err(error) => {
            let _ = remove_path(&root.join(&content.relative_path), operation);
            return Err(error);
        }
    };
    store.revision = revision;
    store.packages.insert(
        package_id.to_string(),
        PackageRecord {
            manifest: input.manifest().clone(),
            source: input.source().clone(),
            revision,
            content_path: content.relative_path.clone(),
        },
    );
    if let Err(error) = save_store(&state_path(&root), &store, operation) {
        let _ = remove_path(&root.join(&content.relative_path), operation);
        let _ = restore_tombstone(
            &old_tombstone,
            &root.join(&previous.content_path),
            operation,
        );
        return Err(error);
    }
    let _ = remove_path(&old_tombstone, operation);
    Ok(UpdateResult {
        previous_version: Some(previous.manifest.version().to_string()),
        revision,
    })
}

fn remove_package(
    input: &ExtensionPackageRemovePayload,
) -> Result<RemoveResult, HostProtocolError> {
    let operation = host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD;
    let _guard = STORE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("extension package store lock poisoned", operation)
    })?;
    let root = store_root(operation)?;
    let _store_lock = lock_store_file(&root, operation)?;
    ensure_store_root(&root, operation)?;
    let mut store = load_store(&state_path(&root), operation)?;
    let revision = store.revision.saturating_add(1);
    let previous = store.packages.remove(input.package_id());
    store.revision = revision;
    let Some(record) = previous else {
        save_store(&state_path(&root), &store, operation)?;
        return Ok(RemoveResult {
            removed: false,
            revision,
        });
    };
    let tombstone = tombstone_stored_content(&root, &record.content_path, operation)?;
    if let Err(error) = save_store(&state_path(&root), &store, operation) {
        let _ = restore_tombstone(&tombstone, &root.join(&record.content_path), operation);
        return Err(error);
    }
    let _ = remove_path(&tombstone, operation);
    Ok(RemoveResult {
        removed: true,
        revision,
    })
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
            format!("failed to encode extension package payload: {error}"),
            operation,
        )
    })
}

fn package_event(
    timestamp: u64,
    package_id: &str,
    phase: ExtensionPackageEventPhase,
    version: Option<String>,
    revision: Option<u64>,
    reason: Option<String>,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ExtensionPackageEventPayload::new(timestamp, package_id, phase, version, revision, reason),
        operation,
    )
}

fn read_store<T>(
    operation: &'static str,
    read: impl FnOnce(&PackageStore) -> T,
) -> Result<T, HostProtocolError> {
    let _guard = STORE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("extension package store lock poisoned", operation)
    })?;
    let root = store_root(operation)?;
    let _store_lock = lock_store_file(&root, operation)?;
    let store = load_store(&state_path(&root), operation)?;
    Ok(read(&store))
}

fn ensure_store_available(operation: &'static str) -> Result<(), HostProtocolError> {
    let _guard = STORE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("extension package store lock poisoned", operation)
    })?;
    let root = store_root(operation)?;
    let _store_lock = lock_store_file(&root, operation)?;
    ensure_store_root(&root, operation)?;
    let store = load_store(&state_path(&root), operation)?;
    save_store(&state_path(&root), &store, operation)
}

fn load_store(path: &Path, operation: &'static str) -> Result<PackageStore, HostProtocolError> {
    if !path.exists() {
        return Ok(PackageStore::default());
    }
    let body = fs::read_to_string(path).map_err(|error| store_error("read", error, operation))?;
    if body.trim().is_empty() {
        return Ok(PackageStore::default());
    }
    serde_json::from_str(&body).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to decode extension package store: {error}"),
            operation,
        )
    })
}

fn save_store(
    path: &Path,
    store: &PackageStore,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    ensure_parent(path, operation)?;
    let body = serde_json::to_vec_pretty(store).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode extension package store: {error}"),
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

fn persist_verified_source(
    root: &Path,
    package_id: &str,
    revision: u64,
    manifest: &ExtensionPackageManifestPayload,
    payload_source: &ExtensionPackageSourcePayload,
    source: &ResolvedSource,
    operation: &'static str,
) -> Result<InstalledContent, HostProtocolError> {
    let staged_path = temp_content_path(root);
    if staged_path.exists() {
        remove_path(&staged_path, operation)?;
    }
    ensure_parent(&staged_path, operation)?;
    match source.kind {
        ExtensionPackageSourceKind::Directory => {
            copy_directory(&source.path, &staged_path, operation)?
        }
        ExtensionPackageSourceKind::Archive => {
            ensure_parent(&staged_path, operation)?;
            fs::copy(&source.path, &staged_path)
                .map_err(|error| source_error("copy archive", &source.path, error, operation))?;
        }
        ExtensionPackageSourceKind::Registry => {
            return Err(HostProtocolError::unsupported(
                REGISTRY_SOURCE_UNSUPPORTED_REASON,
                operation,
            ));
        }
    }
    let staged_source = ResolvedSource {
        path: staged_path.clone(),
        kind: source.kind,
    };
    if let Err(error) = verify_source_entrypoint(manifest, &staged_source, operation)
        .and_then(|()| verify_source_digest(payload_source, &staged_source, operation))
    {
        let _ = remove_path(&staged_path, operation);
        return Err(error);
    }
    let relative_path = content_relative_path(package_id, revision, source.kind);
    let final_path = root.join(&relative_path);
    if final_path.exists() {
        remove_path(&final_path, operation)?;
    }
    ensure_parent(&final_path, operation)?;
    fs::rename(&staged_path, &final_path).map_err(|error| {
        let _ = remove_path(&staged_path, operation);
        store_error("promote extension package content", error, operation)
    })?;
    Ok(InstalledContent { relative_path })
}

fn copy_directory(
    source: &Path,
    destination: &Path,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    fs::create_dir_all(destination)
        .map_err(|error| store_error("create extension package directory", error, operation))?;
    for entry in sorted_directory_entries(source, operation)? {
        let file_type = entry.file_type().map_err(|error| {
            source_error("read source file type", &entry.path(), error, operation)
        })?;
        if file_type.is_symlink() {
            return Err(HostProtocolError::invalid_argument(
                "source.uri",
                "must not contain symlinks",
                operation,
            ));
        }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_directory(&entry.path(), &target, operation)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)
                .map_err(|error| source_error("copy source file", &target, error, operation))?;
        } else {
            return Err(HostProtocolError::invalid_argument(
                "source.uri",
                "must contain only regular files and directories",
                operation,
            ));
        }
    }
    Ok(())
}

fn verify_source_digest(
    source: &ExtensionPackageSourcePayload,
    resolved: &ResolvedSource,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(expected) = source.digest() else {
        return Ok(());
    };
    let actual = match resolved.kind {
        ExtensionPackageSourceKind::Directory => directory_digest(&resolved.path, operation)?,
        ExtensionPackageSourceKind::Archive => file_digest(&resolved.path, operation)?,
        ExtensionPackageSourceKind::Registry => {
            return Err(HostProtocolError::unsupported(
                REGISTRY_SOURCE_UNSUPPORTED_REASON,
                operation,
            ));
        }
    };
    if expected.eq_ignore_ascii_case(&actual) {
        Ok(())
    } else {
        Err(HostProtocolError::invalid_argument(
            "source.digest",
            "does not match source contents",
            operation,
        ))
    }
}

fn verify_source_entrypoint(
    manifest: &ExtensionPackageManifestPayload,
    source: &ResolvedSource,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !matches!(source.kind, ExtensionPackageSourceKind::Directory) {
        return Ok(());
    }
    let entrypoint = source.path.join(manifest.entrypoint());
    let metadata = fs::symlink_metadata(&entrypoint).map_err(|error| {
        source_error("inspect manifest entrypoint", &entrypoint, error, operation)
    })?;
    if metadata.is_file() && !metadata.file_type().is_symlink() {
        Ok(())
    } else {
        Err(HostProtocolError::invalid_argument(
            "manifest.entrypoint",
            "must point at a regular source file",
            operation,
        ))
    }
}

fn directory_digest(source: &Path, operation: &'static str) -> Result<String, HostProtocolError> {
    let mut hasher = Sha256::new();
    hash_directory(source, source, &mut hasher, operation)?;
    Ok(format_digest(hasher.finalize().as_slice()))
}

fn hash_directory(
    root: &Path,
    current: &Path,
    hasher: &mut Sha256,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for entry in sorted_directory_entries(current, operation)? {
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| source_error("read source file type", &path, error, operation))?;
        if file_type.is_symlink() {
            return Err(HostProtocolError::invalid_argument(
                "source.uri",
                "must not contain symlinks",
                operation,
            ));
        }
        let relative = path.strip_prefix(root).map_err(|_| {
            HostProtocolError::internal("failed to relativize source path", operation)
        })?;
        if file_type.is_dir() {
            hasher.update(b"dir\0");
            hash_relative_path(relative, hasher);
            hasher.update([0]);
            hash_directory(root, &path, hasher, operation)?;
            continue;
        }
        if !file_type.is_file() {
            return Err(HostProtocolError::invalid_argument(
                "source.uri",
                "must contain only regular files and directories",
                operation,
            ));
        }
        let length = fs::symlink_metadata(&path)
            .map_err(|error| source_error("read source file metadata", &path, error, operation))?
            .len();
        hasher.update(b"file\0");
        hash_relative_path(relative, hasher);
        hasher.update([0]);
        hasher.update(length.to_le_bytes());
        hash_file_into(&path, hasher, operation)?;
    }
    Ok(())
}

fn hash_relative_path(path: &Path, hasher: &mut Sha256) {
    let mut first = true;
    for part in path.iter() {
        if first {
            first = false;
        } else {
            hasher.update(b"/");
        }
        #[cfg(unix)]
        hasher.update(part.as_bytes());
        #[cfg(not(unix))]
        hasher.update(part.to_string_lossy().as_bytes());
    }
}

fn file_digest(path: &Path, operation: &'static str) -> Result<String, HostProtocolError> {
    let mut hasher = Sha256::new();
    hash_file_into(path, &mut hasher, operation)?;
    Ok(format_digest(hasher.finalize().as_slice()))
}

fn hash_file_into(
    path: &Path,
    hasher: &mut Sha256,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut file = File::open(path)
        .map_err(|error| source_error("open source file", path, error, operation))?;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| source_error("read source file", path, error, operation))?;
        if read == 0 {
            return Ok(());
        }
        hasher.update(&buffer[..read]);
    }
}

fn format_digest(bytes: &[u8]) -> String {
    let mut output = String::from(SHA256_PREFIX);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn sorted_directory_entries(
    path: &Path,
    operation: &'static str,
) -> Result<Vec<fs::DirEntry>, HostProtocolError> {
    let mut entries = fs::read_dir(path)
        .map_err(|error| source_error("read source directory", path, error, operation))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| source_error("read source directory entry", path, error, operation))?;
    entries.sort_by_key(|entry| entry.path());
    Ok(entries)
}

fn resolve_source(
    source: &ExtensionPackageSourcePayload,
    operation: &'static str,
) -> Result<ResolvedSource, HostProtocolError> {
    let kind = source.kind();
    if matches!(kind, ExtensionPackageSourceKind::Registry) {
        return Err(HostProtocolError::unsupported(
            REGISTRY_SOURCE_UNSUPPORTED_REASON,
            operation,
        ));
    }
    let path = source_path(source.uri(), operation)?;
    let submitted_metadata = fs::symlink_metadata(&path)
        .map_err(|error| source_error("inspect source", &path, error, operation))?;
    if submitted_metadata.file_type().is_symlink() {
        return Err(HostProtocolError::invalid_argument(
            "source.uri",
            "must not contain symlinks",
            operation,
        ));
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|error| source_error("resolve source", &path, error, operation))?;
    match kind {
        ExtensionPackageSourceKind::Directory if submitted_metadata.is_dir() => {
            Ok(ResolvedSource {
                path: canonical,
                kind,
            })
        }
        ExtensionPackageSourceKind::Archive if submitted_metadata.is_file() => Ok(ResolvedSource {
            path: canonical,
            kind,
        }),
        ExtensionPackageSourceKind::Directory => Err(HostProtocolError::invalid_argument(
            "source.uri",
            "directory source must point at a directory",
            operation,
        )),
        ExtensionPackageSourceKind::Archive => Err(HostProtocolError::invalid_argument(
            "source.uri",
            "archive source must point at a file",
            operation,
        )),
        ExtensionPackageSourceKind::Registry => unreachable!("registry source returned early"),
    }
}

fn source_path(uri: &str, operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if uri.contains('%') {
        return Err(HostProtocolError::invalid_argument(
            "source.uri",
            "must not contain percent escapes",
            operation,
        ));
    }
    if let Some(path) = uri.strip_prefix("file://") {
        if !path.starts_with('/') {
            return Err(HostProtocolError::invalid_argument(
                "source.uri",
                "file URI must contain an absolute path",
                operation,
            ));
        }
        #[cfg(windows)]
        {
            let without_slash = path.strip_prefix('/').unwrap_or(path);
            if without_slash.as_bytes().get(1) == Some(&b':') {
                return Ok(PathBuf::from(without_slash));
            }
        }
        return Ok(PathBuf::from(path));
    }
    let path = PathBuf::from(uri);
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(HostProtocolError::invalid_argument(
            "source.uri",
            "must be an absolute local path or file URI",
            operation,
        ))
    }
}

fn tombstone_stored_content(
    root: &Path,
    relative_path: &str,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    let path = root.join(relative_path);
    if !path.exists() {
        return Err(store_error(
            "find stored package content",
            std::io::Error::new(std::io::ErrorKind::NotFound, path.display().to_string()),
            operation,
        ));
    }
    let tombstone = temp_content_path(root);
    if tombstone.exists() {
        remove_path(&tombstone, operation)?;
    }
    ensure_parent(&tombstone, operation)?;
    fs::rename(&path, &tombstone)
        .map_err(|error| store_error("tombstone extension package content", error, operation))?;
    Ok(tombstone)
}

fn restore_tombstone(
    tombstone: &Path,
    path: &Path,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if path.exists() {
        remove_path(path, operation)?;
    }
    ensure_parent(path, operation)?;
    fs::rename(tombstone, path)
        .map_err(|error| store_error("restore extension package content", error, operation))
}

fn remove_path(path: &Path, operation: &'static str) -> Result<(), HostProtocolError> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| store_error("inspect path", error, operation))?;
    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| store_error("remove directory", error, operation))
    } else {
        fs::remove_file(path).map_err(|error| store_error("remove file", error, operation))
    }
}

fn ensure_store_root(root: &Path, operation: &'static str) -> Result<(), HostProtocolError> {
    fs::create_dir_all(root).map_err(|error| store_error("create store root", error, operation))?;
    fs::create_dir_all(root.join(PACKAGES_DIR))
        .map_err(|error| store_error("create package content directory", error, operation))?;
    fs::create_dir_all(root.join(TEMP_DIR))
        .map_err(|error| store_error("create package temp directory", error, operation))?;
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

fn content_relative_path(
    package_id: &str,
    revision: u64,
    kind: ExtensionPackageSourceKind,
) -> String {
    let leaf = match kind {
        ExtensionPackageSourceKind::Directory => "content",
        ExtensionPackageSourceKind::Archive => "archive",
        ExtensionPackageSourceKind::Registry => "registry",
    };
    format!("{PACKAGES_DIR}/{package_id}/{revision}/{leaf}")
}

fn temp_content_path(root: &Path) -> PathBuf {
    root.join(TEMP_DIR)
        .join(format!("package.{}.tmp", uuid::Uuid::new_v4()))
}

fn state_path(root: &Path) -> PathBuf {
    root.join(STORE_FILE)
}

fn temp_store_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(STORE_FILE);
    path.with_file_name(format!("{file_name}.{}.tmp", uuid::Uuid::new_v4()))
}

fn lock_store_file(
    root: &Path,
    operation: &'static str,
) -> Result<StoreFileLockGuard, HostProtocolError> {
    fs::create_dir_all(root)
        .map_err(|error| store_error("create lock directory", error, operation))?;
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .truncate(false)
        .write(true)
        .open(root.join(STORE_LOCK_FILE))
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
            "failed to lock extension package store: {}",
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
            "failed to lock extension package store: {}",
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
        format!("failed to {action} extension package store: {error}"),
        operation,
    )
}

fn source_error(
    action: &'static str,
    path: &Path,
    error: std::io::Error,
    operation: &'static str,
) -> HostProtocolError {
    HostProtocolError::invalid_argument(
        "source.uri",
        format!("failed to {action} {}: {error}", path.display()),
        operation,
    )
}

fn store_root(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if let Some(path) = std::env::var_os(STORE_ENV).map(PathBuf::from) {
        return Ok(path);
    }
    default_store_root()
        .ok_or_else(|| HostProtocolError::unsupported(STORE_UNAVAILABLE_REASON, operation))
}

#[cfg(target_os = "macos")]
fn default_store_root() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).map(|home| {
        home.join("Library")
            .join("Application Support")
            .join(STORE_DIR)
            .join(STORE_ROOT)
    })
}

#[cfg(target_os = "windows")]
fn default_store_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .map(|data| data.join(STORE_DIR).join(STORE_ROOT))
}

#[cfg(target_os = "linux")]
fn default_store_root() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".config"))
        })
        .map(|config| config.join(STORE_DIR).join(STORE_ROOT))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn default_store_root() -> Option<PathBuf> {
    None
}

fn validate_install(
    input: &ExtensionPackageInstallPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_source(input.source(), operation)?;
    validate_manifest(input.manifest(), operation)
}

fn validate_update(
    input: &ExtensionPackageUpdatePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_source(input.source(), operation)?;
    validate_manifest(input.manifest(), operation)?;
    if let Some(expected_version) = input.expected_version() {
        validate_version("expectedVersion", expected_version, operation)?;
    }
    Ok(())
}

fn validate_remove(
    input: &ExtensionPackageRemovePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_name("packageId", input.package_id(), operation)
}

fn validate_actor(
    actor: &ExtensionPackageActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_name("actor.id", actor.id(), operation)
}

fn validate_source(
    source: &ExtensionPackageSourcePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if source.uri().trim() != source.uri() {
        return Err(HostProtocolError::invalid_argument(
            "source.uri",
            "must not include leading or trailing whitespace",
            operation,
        ));
    }
    if let Some(digest) = source.digest() {
        validate_sha256_digest("source.digest", digest, operation)?;
    }
    Ok(())
}

fn validate_manifest(
    manifest: &ExtensionPackageManifestPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_name("manifest.id", manifest.id(), operation)?;
    validate_version("manifest.version", manifest.version(), operation)?;
    validate_entrypoint(manifest.entrypoint(), operation)?;
    if manifest.capabilities().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.capabilities",
            "must declare at least one capability",
            operation,
        ));
    }
    let mut capabilities = BTreeSet::new();
    for declaration in manifest.capabilities() {
        validate_capability(declaration.capability(), operation)?;
        let key = serde_json::to_string(declaration.capability()).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to canonicalize extension package capability: {error}"),
                operation,
            )
        })?;
        if !capabilities.insert(key) {
            return Err(HostProtocolError::invalid_argument(
                "manifest.capabilities",
                "must be unique",
                operation,
            ));
        }
    }
    if let Some(min_host_version) = manifest.compatibility().min_host_version() {
        validate_version(
            "manifest.compatibility.minHostVersion",
            min_host_version,
            operation,
        )?;
    }
    if let Some(max_host_version) = manifest.compatibility().max_host_version() {
        validate_version(
            "manifest.compatibility.maxHostVersion",
            max_host_version,
            operation,
        )?;
    }
    if let (Some(min_host_version), Some(max_host_version)) = (
        manifest.compatibility().min_host_version(),
        manifest.compatibility().max_host_version(),
    ) {
        if compare_semver(min_host_version, max_host_version) > 0 {
            return Err(HostProtocolError::invalid_argument(
                "manifest.compatibility",
                "minHostVersion must be less than or equal to maxHostVersion",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_capability(
    capability: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(kind) = capability.get("kind").and_then(Value::as_str) else {
        return Err(HostProtocolError::invalid_argument(
            "manifest.capabilities.capability.kind",
            "must be a string",
            operation,
        ));
    };
    if kind.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.capabilities.capability.kind",
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_entrypoint(entrypoint: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if entrypoint.starts_with('/') || entrypoint.contains('\\') || entrypoint.contains("://") {
        return Err(HostProtocolError::invalid_argument(
            "manifest.entrypoint",
            "must be a relative package path",
            operation,
        ));
    }
    if entrypoint
        .split('/')
        .any(|part| part.is_empty() || matches!(part, "." | ".."))
    {
        return Err(HostProtocolError::invalid_argument(
            "manifest.entrypoint",
            "must stay inside the package",
            operation,
        ));
    }
    Ok(())
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
    if matches!(value, "." | "..") {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be a dot segment",
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

fn validate_version(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !valid_semver(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be SemVer",
            operation,
        ));
    }
    Ok(())
}

fn valid_semver(value: &str) -> bool {
    let mut build_split = value.splitn(2, '+');
    let release = build_split.next().unwrap_or_default();
    let build = build_split.next();
    if build.is_some_and(|value| !valid_build_metadata(value)) {
        return false;
    }
    let mut prerelease_split = release.splitn(2, '-');
    let core = prerelease_split.next().unwrap_or_default();
    let prerelease = prerelease_split.next();
    valid_semver_core(core) && prerelease.is_none_or(valid_prerelease)
}

fn valid_semver_core(core: &str) -> bool {
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| valid_semver_number(part))
}

fn valid_semver_number(part: &str) -> bool {
    if part.is_empty() || !part.chars().all(|value| value.is_ascii_digit()) {
        return false;
    }
    if part != "0" && part.starts_with('0') {
        return false;
    }
    part.parse::<u64>().is_ok()
}

fn valid_prerelease(value: &str) -> bool {
    valid_dot_identifiers(value, |identifier| {
        valid_semver_identifier(identifier)
            && (!is_numeric(identifier) || valid_semver_number(identifier))
    })
}

fn valid_build_metadata(value: &str) -> bool {
    valid_dot_identifiers(value, valid_semver_identifier)
}

fn valid_dot_identifiers(value: &str, is_valid: impl Fn(&str) -> bool) -> bool {
    !value.is_empty() && value.split('.').all(is_valid)
}

fn valid_semver_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn is_numeric(value: &str) -> bool {
    value.chars().all(|character| character.is_ascii_digit())
}

fn compare_semver(left: &str, right: &str) -> i8 {
    let left_parts = semver_numbers(left);
    let right_parts = semver_numbers(right);
    for index in 0..3 {
        match left_parts[index].cmp(&right_parts[index]) {
            std::cmp::Ordering::Less => return -1,
            std::cmp::Ordering::Greater => return 1,
            std::cmp::Ordering::Equal => {}
        }
    }
    0
}

fn semver_numbers(value: &str) -> [u64; 3] {
    let mut parts = value
        .split(['-', '+'])
        .next()
        .unwrap_or_default()
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0));
    [
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    ]
}

fn validate_sha256_digest(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let digest = value.strip_prefix(SHA256_PREFIX).ok_or_else(|| {
        HostProtocolError::invalid_argument(field, "must be a sha256 digest", operation)
    })?;
    if digest.len() == 64 && digest.chars().all(|value| value.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(HostProtocolError::invalid_argument(
            field,
            "must be a sha256 digest",
            operation,
        ))
    }
}

fn declared_capabilities(manifest: &ExtensionPackageManifestPayload) -> Vec<Value> {
    manifest
        .capabilities()
        .iter()
        .map(|declaration| declaration.capability().clone())
        .collect()
}

fn already_exists(resource: &str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::AlreadyExists {
        resource: resource.to_string(),
        message: format!("resource already exists: {resource}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("AlreadyExists").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn invalid_state(
    current: &str,
    attempted: &str,
    message: &str,
    operation: &'static str,
) -> HostProtocolError {
    HostProtocolError::InvalidState {
        current: current.to_string(),
        attempted: attempted.to_string(),
        message: message.to_string(),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compare_semver, directory_digest, file_digest, install, install_with_event, is_supported,
        list, remove, update, valid_semver, EXTENSION_PACKAGE_ENV_LOCK,
    };
    use host_protocol::{ExtensionPackageEventPhase, HostProtocolError};
    use serde_json::{json, Value};
    use std::fs;
    use std::path::Path;

    #[test]
    fn install_persists_directory_package_and_list_returns_state() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("install-list");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "export default 1\n").expect("source file");
        set_store(&store);

        let payload = install(Some(valid_install_payload(&source, None))).expect("install");
        let listed = list().expect("list");

        assert_eq!(
            payload,
            Some(json!({
                "packageId": "extension-1",
                "version": "1.0.0",
                "revision": 1,
                "registeredCapabilities": [
                    {
                        "kind": "filesystem.read",
                        "roots": ["/tmp/extensions"],
                        "audit": "always"
                    }
                ]
            }))
        );
        assert_eq!(
            listed
                .as_ref()
                .and_then(|value| value.get("packages"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert!(store
            .join("packages/extension-1/1/content/dist/main.js")
            .exists());
        clear_store();
    }

    #[test]
    fn install_rejects_digest_mismatch_before_persisting_state() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("digest-mismatch");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "actual\n").expect("source file");
        set_store(&store);

        let error = install(Some(valid_install_payload(
            &source,
            Some("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        )))
        .expect_err("digest mismatch should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "source.digest",
                "does not match source contents",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
        assert!(list()
            .expect("list")
            .and_then(|value| value.get("packages").cloned())
            .and_then(|value| value.as_array().cloned())
            .is_some_and(|packages| packages.is_empty()));
        clear_store();
    }

    #[test]
    fn directory_digest_binds_empty_directories() {
        let temp = temp_root("directory-digest-empty-dir");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "actual\n").expect("source file");

        let before = directory_digest(&source, host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD)
            .expect("digest");
        fs::create_dir_all(source.join("empty")).expect("empty dir");
        let after = directory_digest(&source, host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD)
            .expect("digest");

        assert_ne!(before, after);
    }

    #[test]
    fn install_persists_archive_package_and_verifies_archive_digest() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("archive-install");
        let store = temp.join("store");
        let archive = temp.join("extension.tar");
        fs::write(&archive, "archive bytes\n").expect("archive file");
        set_store(&store);
        let digest =
            file_digest(&archive, host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD).expect("digest");
        let mut payload = valid_install_payload(&archive, Some(&digest));
        payload["source"]["kind"] = json!("archive");

        let installed = install(Some(payload)).expect("archive install");
        let listed = list().expect("list");

        assert_eq!(
            installed.as_ref().and_then(|value| value.get("revision")),
            Some(&json!(1))
        );
        assert!(store.join("packages/extension-1/1/archive").exists());
        assert_eq!(
            listed
                .as_ref()
                .and_then(|value| value.get("packages"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        clear_store();
    }

    #[test]
    fn archive_digest_mismatch_fails_before_persisting_state() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("archive-digest-mismatch");
        let store = temp.join("store");
        let archive = temp.join("extension.tar");
        fs::write(&archive, "archive bytes\n").expect("archive file");
        set_store(&store);
        let mut payload = valid_install_payload(
            &archive,
            Some("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
        payload["source"]["kind"] = json!("archive");

        let error = install(Some(payload)).expect_err("archive digest mismatch should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "source.digest",
                "does not match source contents",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
        assert!(list()
            .expect("list")
            .and_then(|value| value.get("packages").cloned())
            .and_then(|value| value.as_array().cloned())
            .is_some_and(|packages| packages.is_empty()));
        clear_store();
    }

    #[test]
    fn install_rejects_duplicate_manifest_capabilities() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("duplicate-capabilities");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        set_store(&store);
        let mut payload = valid_install_payload(&source, None);
        let duplicate = payload["manifest"]["capabilities"][0].clone();
        payload["manifest"]["capabilities"]
            .as_array_mut()
            .expect("capabilities")
            .push(duplicate);

        let error = install(Some(payload)).expect_err("duplicate capability should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.capabilities",
                "must be unique",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
        assert!(!store.join("packages").exists());
        clear_store();
    }

    #[test]
    fn install_rejects_dot_segment_package_ids_before_storage_paths() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("dot-segment-id");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        set_store(&store);
        let mut payload = valid_install_payload(&source, None);
        payload["manifest"]["id"] = json!("..");

        let error = install(Some(payload)).expect_err("dot segment package id should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.id",
                "must not be a dot segment",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
        assert!(!store.join("packages").exists());
        clear_store();
    }

    #[cfg(unix)]
    #[test]
    fn install_rejects_source_root_symlink() {
        use std::os::unix::fs::symlink;

        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("root-symlink");
        let store = temp.join("store");
        let source = temp.join("source");
        let link = temp.join("source-link");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        symlink(&source, &link).expect("source symlink");
        set_store(&store);

        let error = install(Some(valid_install_payload(&link, None)))
            .expect_err("symlink root should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "source.uri",
                "must not contain symlinks",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
        assert!(!store.join("packages").exists());
        clear_store();
    }

    #[test]
    fn update_requires_existing_package_and_expected_version_match() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("update");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        set_store(&store);
        install(Some(valid_install_payload(&source, None))).expect("install");

        let mut update_payload = valid_install_payload(&source, None);
        update_payload["manifest"]["version"] = json!("2.0.0");
        update_payload["expectedVersion"] = json!("0.9.0");
        let error = update(Some(update_payload)).expect_err("stale update should fail");

        assert!(matches!(error, HostProtocolError::InvalidState { .. }));
        clear_store();
    }

    #[test]
    fn update_persists_new_revision_and_remove_deletes_package() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("update-remove");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        set_store(&store);
        install(Some(valid_install_payload(&source, None))).expect("install");

        fs::write(source.join("dist/main.js"), "v2\n").expect("source file");
        let mut update_payload = valid_install_payload(&source, None);
        update_payload["manifest"]["version"] = json!("2.0.0");
        update_payload["expectedVersion"] = json!("1.0.0");
        let updated = update(Some(update_payload)).expect("update");
        let removed = remove(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "packageId": "extension-1"
        })))
        .expect("remove");

        assert_eq!(
            updated,
            Some(json!({
                "packageId": "extension-1",
                "previousVersion": "1.0.0",
                "version": "2.0.0",
                "revision": 2,
                "registeredCapabilities": [
                    {
                        "kind": "filesystem.read",
                        "roots": ["/tmp/extensions"],
                        "audit": "always"
                    }
                ]
            }))
        );
        assert_eq!(
            removed,
            Some(json!({
                "packageId": "extension-1",
                "removed": true,
                "revision": 3
            }))
        );
        assert!(list()
            .expect("list")
            .and_then(|value| value.get("packages").cloned())
            .and_then(|value| value.as_array().cloned())
            .is_some_and(|packages| packages.is_empty()));
        clear_store();
    }

    #[test]
    fn remove_reports_missing_stored_content_without_changing_state() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("missing-content-remove");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        set_store(&store);
        install(Some(valid_install_payload(&source, None))).expect("install");
        fs::remove_dir_all(store.join("packages/extension-1/1/content"))
            .expect("remove stored content");

        let error = remove(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "packageId": "extension-1"
        })))
        .expect_err("missing stored content should fail");
        let listed = list().expect("list");

        assert!(matches!(error, HostProtocolError::Internal { .. }));
        assert_eq!(
            listed
                .as_ref()
                .and_then(|value| value.get("packages"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        clear_store();
    }

    #[test]
    fn install_with_event_returns_lifecycle_event_before_response() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("install-event");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        set_store(&store);

        let (_payload, event) =
            install_with_event(Some(valid_install_payload(&source, None)), 1710000000000)
                .expect("install event");

        assert_eq!(
            event,
            Some(json!({
                "type": "extension-package-event",
                "timestamp": 1710000000000_u64,
                "packageId": "extension-1",
                "phase": ExtensionPackageEventPhase::Installed,
                "version": "1.0.0",
                "revision": 1
            }))
        );
        clear_store();
    }

    #[test]
    fn install_rejects_manifest_escape_before_source_copy() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("invalid-entrypoint");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        set_store(&store);
        let mut payload = valid_install_payload(&source, None);
        payload["manifest"]["entrypoint"] = json!("../escape.js");

        let error = install(Some(payload)).expect_err("invalid entrypoint must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.entrypoint",
                "must stay inside the package",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
        assert!(!store.join("packages").exists());
        clear_store();
    }

    #[test]
    fn registry_source_returns_typed_unsupported() {
        let mut payload = valid_install_payload(Path::new("/tmp/unused"), None);
        payload["source"] = json!({ "kind": "registry", "uri": "effect://extension-1" });
        let error = install(Some(payload)).expect_err("registry source should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                "extension-package-registry-source-unimplemented",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
    }

    #[test]
    fn is_supported_probes_store() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("support");
        set_store(&temp.join("store"));

        let payload = is_supported().expect("support payload should encode");

        assert_eq!(payload, Some(json!({ "supported": true })));
        clear_store();
    }

    #[test]
    fn valid_semver_rejects_overflowing_numeric_component() {
        assert!(valid_semver("1.0.0"));
        assert!(valid_semver("18446744073709551615.0.0"));
        assert!(!valid_semver("99999999999999999999.0.0"));
        assert!(!valid_semver("18446744073709551616.0.0"));
        assert!(!valid_semver("1.0.99999999999999999999"));
    }

    #[test]
    fn compare_semver_orders_large_in_range_components() {
        assert_eq!(compare_semver("18446744073709551615.0.0", "1.0.0"), 1);
        assert_eq!(compare_semver("1.0.0", "18446744073709551615.0.0"), -1);
    }

    #[test]
    fn install_rejects_incoherent_compatibility_before_persisting_state() {
        let _guard = EXTENSION_PACKAGE_ENV_LOCK.lock().expect("env lock");
        let temp = temp_root("incoherent-compatibility");
        let store = temp.join("store");
        let source = temp.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir");
        fs::write(source.join("dist/main.js"), "v1\n").expect("source file");
        set_store(&store);
        let mut payload = valid_install_payload(&source, None);
        payload["manifest"]["compatibility"]["minHostVersion"] = json!("99999999999999999999.0.0");
        payload["manifest"]["compatibility"]["maxHostVersion"] = json!("1.0.0");

        let error = install(Some(payload)).expect_err("overflowing minHostVersion must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.compatibility.minHostVersion",
                "must be SemVer",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
        assert!(!store.join("packages").exists());
        clear_store();
    }

    fn valid_install_payload(source: &Path, digest: Option<&str>) -> serde_json::Value {
        let source = source.to_string_lossy();
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "source": {
                "kind": "directory",
                "uri": source,
                "digest": digest.unwrap_or("")
            },
            "manifest": {
                "id": "extension-1",
                "name": "Extension One",
                "version": "1.0.0",
                "entrypoint": "dist/main.js",
                "compatibility": {
                    "minHostVersion": "1.0.0",
                    "maxHostVersion": "2.0.0"
                },
                "capabilities": [
                    {
                        "capability": {
                            "kind": "filesystem.read",
                            "roots": ["/tmp/extensions"],
                            "audit": "always"
                        },
                        "reason": "read extension files"
                    }
                ]
            },
            "traceId": "trace-extension-package"
        })
        .as_object()
        .map(|object| {
            let mut value = Value::Object(object.clone());
            if digest.is_none() {
                value["source"]
                    .as_object_mut()
                    .expect("source object")
                    .remove("digest");
            }
            value
        })
        .expect("object")
    }

    fn temp_root(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "effect-desktop-extension-package-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("temp root");
        path
    }

    fn set_store(path: &Path) {
        std::env::set_var("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE", path);
    }

    fn clear_store() {
        std::env::remove_var("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE");
    }
}

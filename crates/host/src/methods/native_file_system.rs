#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    CanonicalPathPayload, HostProtocolEnvelope, HostProtocolError,
    NativeFileSystemEntryKindPayload, NativeFileSystemEventPayload,
    NativeFileSystemEventPhasePayload, NativeFileSystemMetadataPayload,
    NativeFileSystemOpenModePayload, NativeFileSystemOpenPayload,
    NativeFileSystemOpenResultPayload, NativeFileSystemResourcePayload,
    NativeFileSystemStatPayload, NativeFileSystemStopWatchingPayload,
    NativeFileSystemStopWatchingResultPayload, NativeFileSystemSupportedPayload,
    NativeFileSystemWatchPayload, NativeFileSystemWatchResultPayload,
};
use notify::{EventKind, RecursiveMode, Watcher};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    sync::{mpsc::Sender, LazyLock, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

struct NativeFileSystemHandleRecord {
    _file: File,
    _path: PathBuf,
    _owner_scope: String,
}

struct NativeFileSystemWatchRecord {
    watcher: notify::RecommendedWatcher,
    path: PathBuf,
    _owner_scope: String,
}

#[derive(Default)]
struct NativeFileSystemState {
    handles: HashMap<String, NativeFileSystemHandleRecord>,
    watches: HashMap<String, NativeFileSystemWatchRecord>,
}

static NATIVE_FILE_SYSTEM_STATE: LazyLock<Mutex<NativeFileSystemState>> =
    LazyLock::new(|| Mutex::new(NativeFileSystemState::default()));
#[cfg(test)]
static NATIVE_FILE_SYSTEM_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub(crate) fn open(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_fields(
        payload.as_ref(),
        &["mode", "handleId"],
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    let input = decode_payload::<NativeFileSystemOpenPayload>(
        payload,
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    validate_path(
        input.path().path(),
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    validate_optional_id(
        input.handle_id(),
        "handleId",
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;

    let path = PathBuf::from(input.path().path());
    let metadata = metadata_payload(
        input.path().path(),
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    let file = open_file(
        &path,
        input
            .mode()
            .unwrap_or(NativeFileSystemOpenModePayload::Read),
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    let handle_id = input
        .handle_id()
        .map(ToString::to_string)
        .unwrap_or_else(generate_resource_id);
    let owner_scope = format!("native-file-system:{handle_id}");
    insert_handle(
        handle_id.clone(),
        NativeFileSystemHandleRecord {
            _file: file,
            _path: path,
            _owner_scope: owner_scope.clone(),
        },
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;

    encode_payload(
        NativeFileSystemOpenResultPayload::new(
            NativeFileSystemResourcePayload::handle(handle_id, 0, owner_scope),
            metadata,
        ),
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )
}

pub(crate) fn stat(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<NativeFileSystemStatPayload>(
        payload,
        host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD,
    )?;
    validate_path(
        input.path().path(),
        host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD,
    )?;
    encode_payload(
        metadata_payload(
            input.path().path(),
            host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD,
        )?,
        host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD,
    )
}

pub(crate) fn watch_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_null_fields(
        payload.as_ref(),
        &["recursive", "watchId", "ownerScope"],
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    let input = decode_payload::<NativeFileSystemWatchPayload>(
        payload,
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    validate_path(
        input.path().path(),
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    validate_optional_id(
        input.watch_id(),
        "watchId",
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    validate_optional_id(
        input.owner_scope(),
        "ownerScope",
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;

    let path = PathBuf::from(input.path().path());
    let watch_id = input
        .watch_id()
        .map(ToString::to_string)
        .unwrap_or_else(generate_resource_id);
    let owner_scope = input
        .owner_scope()
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("native-file-system:{watch_id}"));
    let recursive = input.recursive().unwrap_or(false);
    let mut watcher = create_watcher(watch_id.clone(), path.clone(), event_sender.clone())?;
    watcher
        .watch(
            &path,
            if recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            },
        )
        .map_err(|error| {
            map_notify_error(
                error,
                input.path().path(),
                host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
            )
        })?;
    insert_watch(
        watch_id.clone(),
        NativeFileSystemWatchRecord {
            watcher,
            path: path.clone(),
            _owner_scope: owner_scope.clone(),
        },
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    send_event(
        event_sender,
        NativeFileSystemEventPayload::watch_started(
            timestamp_millis(),
            watch_id.clone(),
            CanonicalPathPayload::new(input.path().path()),
        ),
    );

    encode_payload(
        NativeFileSystemWatchResultPayload::new(
            NativeFileSystemResourcePayload::watch(watch_id, 0, owner_scope),
            CanonicalPathPayload::new(input.path().path()),
            recursive,
        ),
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )
}

pub(crate) fn stop_watching_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<NativeFileSystemStopWatchingPayload>(
        payload,
        host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
    )?;
    validate_id(
        input.watch_id(),
        "watchId",
        host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
    )?;
    let mut record = remove_watch(
        input.watch_id(),
        host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
    )?;
    let _ = record.watcher.unwatch(&record.path);
    send_event(
        event_sender,
        NativeFileSystemEventPayload::watch_stopped(timestamp_millis(), input.watch_id()),
    );
    encode_payload(
        NativeFileSystemStopWatchingResultPayload::new(input.watch_id(), true),
        host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        NativeFileSystemSupportedPayload::supported(),
        host_protocol::NATIVE_FILE_SYSTEM_IS_SUPPORTED_METHOD,
    )
}

pub(crate) fn close_resource_for_cancel(
    resource_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(resource_id) = resource_id else {
        return Ok(());
    };
    let mut state = state(operation)?;
    state.handles.remove(resource_id);
    if let Some(mut record) = state.watches.remove(resource_id) {
        let _ = record.watcher.unwatch(&record.path);
    }
    Ok(())
}

pub(crate) fn clear_runtime_resources(operation: &'static str) -> Result<(), HostProtocolError> {
    let mut state = state(operation)?;
    state.handles.clear();
    for (_, mut record) in state.watches.drain() {
        let _ = record.watcher.unwatch(&record.path);
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn state_test_guard() -> std::sync::MutexGuard<'static, ()> {
    let guard = NATIVE_FILE_SYSTEM_TEST_LOCK
        .lock()
        .expect("native filesystem test lock should not be poisoned");
    clear_runtime_resources("host.runtime.test")
        .expect("native filesystem test state should clear");
    guard
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
            format!("failed to encode native filesystem payload: {error}"),
            operation,
        )
    })
}

fn reject_null_fields(
    payload: Option<&Value>,
    fields: &[&'static str],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for &field in fields {
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
    }
    Ok(())
}

fn validate_path(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if path.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must be non-empty",
            operation,
        ));
    }
    if path.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must not contain NUL bytes",
            operation,
        ));
    }
    if !is_safe_absolute_path(path) {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must be an absolute path without dot segments",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_id(
    value: Option<&str>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match value {
        Some(value) => validate_id(value, field, operation),
        None => Ok(()),
    }
}

fn validate_id(
    value: &str,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL bytes",
            operation,
        ));
    }
    Ok(())
}

fn is_safe_absolute_path(path: &str) -> bool {
    if path.starts_with('/') {
        return !has_dot_segment(path.split('/'));
    }

    if is_windows_drive_absolute_path(path) || is_windows_unc_absolute_path(path) {
        return !has_dot_segment(path.split(['/', '\\']));
    }

    false
}

fn is_windows_drive_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn is_windows_unc_absolute_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("\\\\") else {
        return false;
    };
    let mut parts = rest.split(['/', '\\']).filter(|part| !part.is_empty());
    parts.next().is_some() && parts.next().is_some()
}

fn has_dot_segment<'a>(segments: impl Iterator<Item = &'a str>) -> bool {
    segments
        .into_iter()
        .any(|segment| segment == "." || segment == "..")
}

fn open_file(
    path: &Path,
    mode: NativeFileSystemOpenModePayload,
    operation: &'static str,
) -> Result<File, HostProtocolError> {
    let mut options = OpenOptions::new();
    match mode {
        NativeFileSystemOpenModePayload::Read => {
            options.read(true);
        }
        NativeFileSystemOpenModePayload::Write => {
            options.write(true);
        }
        NativeFileSystemOpenModePayload::ReadWrite => {
            options.read(true).write(true);
        }
    }
    options
        .open(path)
        .map_err(|error| map_io_error(error, &path.to_string_lossy(), operation))
}

fn metadata_payload(
    path: &str,
    operation: &'static str,
) -> Result<NativeFileSystemMetadataPayload, HostProtocolError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| map_io_error(error, path, operation))?;
    let file_type = metadata.file_type();
    let kind = if file_type.is_file() {
        NativeFileSystemEntryKindPayload::File
    } else if file_type.is_dir() {
        NativeFileSystemEntryKindPayload::Directory
    } else if file_type.is_symlink() {
        NativeFileSystemEntryKindPayload::Symlink
    } else {
        NativeFileSystemEntryKindPayload::Other
    };
    let mut payload = NativeFileSystemMetadataPayload::new(CanonicalPathPayload::new(path), kind)
        .with_size_bytes(metadata.len());
    if let Ok(modified) = metadata.modified() {
        if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
            if let Ok(millis) = u64::try_from(duration.as_millis()) {
                payload = payload.with_modified_millis(millis);
            }
        }
    }
    Ok(payload)
}

fn create_watcher(
    watch_id: String,
    fallback_path: PathBuf,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<notify::RecommendedWatcher, HostProtocolError> {
    let error_path = fallback_path.clone();
    notify::recommended_watcher(move |event| {
        handle_notify_event(event, &watch_id, &fallback_path, event_sender.clone());
    })
    .map_err(|error| {
        map_notify_error(
            error,
            &error_path.to_string_lossy(),
            host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
        )
    })
}

fn handle_notify_event(
    event: notify::Result<notify::Event>,
    watch_id: &str,
    fallback_path: &Path,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) {
    let payload = match event {
        Ok(event) => {
            let phase = if event.kind.is_remove() {
                NativeFileSystemEventPhasePayload::Removed
            } else if is_mutating_event_kind(event.kind) {
                NativeFileSystemEventPhasePayload::Changed
            } else {
                return;
            };
            let path = event
                .paths
                .first()
                .map_or(fallback_path, std::convert::AsRef::as_ref);
            let Some(path) = path_to_valid_payload(path) else {
                return send_event(
                    event_sender,
                    NativeFileSystemEventPayload::failed(
                        timestamp_millis(),
                        watch_id,
                        "watch event path was not a valid absolute path",
                    ),
                );
            };
            match phase {
                NativeFileSystemEventPhasePayload::Changed => {
                    NativeFileSystemEventPayload::changed(timestamp_millis(), watch_id, path)
                }
                NativeFileSystemEventPhasePayload::Removed => {
                    NativeFileSystemEventPayload::removed(timestamp_millis(), watch_id, path)
                }
                _ => unreachable!("notify events only map to changed or removed"),
            }
        }
        Err(error) => NativeFileSystemEventPayload::failed(
            timestamp_millis(),
            watch_id,
            format!("filesystem watcher failed: {error}"),
        ),
    };
    send_event(event_sender, payload);
}

fn is_mutating_event_kind(kind: EventKind) -> bool {
    kind.is_create() || kind.is_modify() || matches!(kind, EventKind::Any | EventKind::Other)
}

fn path_to_valid_payload(path: &Path) -> Option<CanonicalPathPayload> {
    let value = path.to_str()?;
    is_safe_absolute_path(value).then(|| CanonicalPathPayload::new(value))
}

fn send_event(sender: Option<Sender<HostProtocolEnvelope>>, payload: NativeFileSystemEventPayload) {
    let Some(sender) = sender else {
        return;
    };
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::NATIVE_FILE_SYSTEM_EVENT.to_string(),
        timestamp: timestamp_millis(),
        trace_id: format!("native-file-system-event-{}", Uuid::now_v7()),
        window_id: None,
        payload: to_value(payload).ok(),
    });
}

fn insert_handle(
    id: String,
    record: NativeFileSystemHandleRecord,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut state = state(operation)?;
    if state.handles.contains_key(&id) {
        return Err(already_exists(&id, operation));
    }
    state.handles.insert(id, record);
    Ok(())
}

fn insert_watch(
    id: String,
    record: NativeFileSystemWatchRecord,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut state = state(operation)?;
    if state.watches.contains_key(&id) {
        return Err(already_exists(&id, operation));
    }
    state.watches.insert(id, record);
    Ok(())
}

fn remove_watch(
    id: &str,
    operation: &'static str,
) -> Result<NativeFileSystemWatchRecord, HostProtocolError> {
    state(operation)?
        .watches
        .remove(id)
        .ok_or_else(|| HostProtocolError::not_found(id, operation))
}

fn state(
    operation: &'static str,
) -> Result<std::sync::MutexGuard<'static, NativeFileSystemState>, HostProtocolError> {
    NATIVE_FILE_SYSTEM_STATE.lock().map_err(|_| {
        HostProtocolError::internal("native filesystem registry lock poisoned", operation)
    })
}

fn map_io_error(error: io::Error, path: &str, operation: &'static str) -> HostProtocolError {
    match error.kind() {
        io::ErrorKind::NotFound => HostProtocolError::not_found(path, operation),
        io::ErrorKind::PermissionDenied => permission_denied(path, operation, &error),
        _ => HostProtocolError::internal(
            format!("native filesystem operation failed for {path}: {error}"),
            operation,
        ),
    }
}

fn map_notify_error(
    error: notify::Error,
    path: &str,
    operation: &'static str,
) -> HostProtocolError {
    HostProtocolError::internal(
        format!("native filesystem watcher failed for {path}: {error}"),
        operation,
    )
}

fn permission_denied(path: &str, operation: &'static str, error: &io::Error) -> HostProtocolError {
    HostProtocolError::PermissionDenied {
        capability: "filesystem".to_string(),
        resource: Some(path.to_string()),
        message: format!("permission denied for native filesystem path {path}: {error}"),
        operation: operation.to_string(),
        platform: None,
        code: error.raw_os_error().map(|code| code.to_string()),
        cause: None,
        recoverable: HostProtocolError::recoverable_default("PermissionDenied").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn already_exists(resource: &str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::AlreadyExists {
        resource: resource.to_string(),
        message: format!("native filesystem resource already exists: {resource}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("AlreadyExists").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn generate_resource_id() -> String {
    Uuid::now_v7().to_string()
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after Unix epoch")
        .as_millis()
        .try_into()
        .expect("timestamp milliseconds should fit in u64")
}

#[cfg(test)]
mod tests {
    use super::{
        clear_runtime_resources, close_resource_for_cancel, is_supported, open, stat,
        stop_watching_with_event_sender, watch_with_event_sender,
    };
    use host_protocol::{HostProtocolEnvelope, HostProtocolError};
    use serde_json::json;
    use std::{
        fs,
        sync::mpsc::{channel, Receiver},
        time::Duration,
    };
    use uuid::Uuid;

    #[test]
    fn native_file_system_opens_stats_watches_and_stops_real_paths() {
        let _guard = super::state_test_guard();
        let fixture = TempFixture::new();
        let file_path = fixture.path("report.txt");
        fs::write(&file_path, b"report").expect("fixture file should write");
        let file_path = file_path.to_string_lossy().to_string();
        let root_path = fixture.root.to_string_lossy().to_string();
        let (sender, receiver) = channel();

        let opened = open(Some(json!({
            "path": { "path": file_path },
            "mode": "read",
            "handleId": "handle-1"
        })))
        .expect("open should succeed")
        .expect("open should encode payload");
        assert_eq!(opened["handle"]["id"], json!("handle-1"));
        assert_eq!(opened["metadata"]["kind"], json!("file"));
        assert_eq!(opened["metadata"]["sizeBytes"], json!(6));

        let metadata = stat(Some(json!({ "path": { "path": file_path } })))
            .expect("stat should succeed")
            .expect("stat should encode payload");
        assert_eq!(metadata["kind"], json!("file"));

        let watched = watch_with_event_sender(
            Some(json!({
                "path": { "path": root_path },
                "recursive": true,
                "watchId": "watch-1",
                "ownerScope": "workspace:workspace-1"
            })),
            Some(sender.clone()),
        )
        .expect("watch should succeed")
        .expect("watch should encode payload");
        assert_eq!(watched["watch"]["id"], json!("watch-1"));
        assert_eq!(watched["recursive"], json!(true));
        assert_event_phase(&receiver, "watch-started");

        let stopped =
            stop_watching_with_event_sender(Some(json!({ "watchId": "watch-1" })), Some(sender))
                .expect("stop should succeed")
                .expect("stop should encode payload");
        assert_eq!(stopped, json!({ "watchId": "watch-1", "stopped": true }));
        assert_event_phase(&receiver, "watch-stopped");
    }

    #[test]
    fn native_file_system_maps_watcher_callbacks_to_typed_events() {
        let fixture = TempFixture::new();
        let changed_path = fixture.path("changed.txt");
        fs::write(&changed_path, b"changed").expect("watched file should write");
        let (sender, receiver) = channel();

        super::handle_notify_event(
            Ok(
                notify::Event::new(notify::EventKind::Create(notify::event::CreateKind::File))
                    .add_path(changed_path),
            ),
            "watch-synthetic",
            &fixture.root,
            Some(sender),
        );

        assert_event_phase(&receiver, "changed");
    }

    #[test]
    fn native_file_system_requests_reject_invalid_input_before_filesystem_work() {
        let _guard = super::state_test_guard();
        assert_eq!(
            open(Some(json!({ "path": { "path": "relative.txt" } })))
                .expect_err("relative path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            stat(Some(json!({ "path": { "path": "/tmp/bad\u{0}path" } })))
                .expect_err("nul path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            stat(Some(json!({ "path": { "path": "/tmp/../secret" } })))
                .expect_err("dot segment path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            stat(Some(json!({ "path": { "path": "\\\\server" } })))
                .expect_err("incomplete unc path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            watch_with_event_sender(
                Some(json!({ "path": { "path": "/tmp" }, "watchId": "" })),
                None
            )
            .expect_err("blank watch id")
            .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            stop_watching_with_event_sender(Some(json!({ "watchId": "" })), None)
                .expect_err("blank stop watch id")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            open(Some(
                json!({ "path": { "path": "/tmp/report.txt" }, "handleId": null })
            ))
            .expect_err("null handle id")
            .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            watch_with_event_sender(
                Some(json!({ "path": { "path": "/tmp" }, "recursive": null })),
                None,
            )
            .expect_err("null recursive")
            .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            watch_with_event_sender(
                Some(json!({ "path": { "path": "/tmp" }, "ownerScope": null })),
                None,
            )
            .expect_err("null owner scope")
            .tag(),
            "InvalidArgument"
        );
    }

    #[test]
    fn native_file_system_missing_paths_and_watches_are_typed_not_found() {
        let _guard = super::state_test_guard();
        let fixture = TempFixture::new();
        let missing_path = fixture.path("missing.txt").to_string_lossy().to_string();

        assert!(matches!(
            stat(Some(json!({ "path": { "path": missing_path } }))).expect_err("missing stat"),
            HostProtocolError::NotFound { .. }
        ));
        assert!(matches!(
            stop_watching_with_event_sender(Some(json!({ "watchId": "missing-watch" })), None)
                .expect_err("missing watch"),
            HostProtocolError::NotFound { .. }
        ));
    }

    #[test]
    fn native_file_system_releases_resources_on_cancel_and_runtime_cleanup() {
        let _guard = super::state_test_guard();
        let fixture = TempFixture::new();
        let file_path = fixture.path("report.txt");
        fs::write(&file_path, b"report").expect("fixture file should write");
        let file_path = file_path.to_string_lossy().to_string();
        let root_path = fixture.root.to_string_lossy().to_string();

        open(Some(json!({
            "path": { "path": file_path },
            "mode": "read",
            "handleId": "handle-cancel"
        })))
        .expect("open should succeed");
        watch_with_event_sender(
            Some(json!({
                "path": { "path": root_path },
                "watchId": "watch-cancel"
            })),
            None,
        )
        .expect("watch should succeed");

        close_resource_for_cancel(Some("handle-cancel"), "host.runtime.cancel")
            .expect("cancel should release handle");
        close_resource_for_cancel(Some("watch-cancel"), "host.runtime.cancel")
            .expect("cancel should release watch");
        assert!(matches!(
            stop_watching_with_event_sender(Some(json!({ "watchId": "watch-cancel" })), None)
                .expect_err("cancelled watch should be gone"),
            HostProtocolError::NotFound { .. }
        ));

        open(Some(json!({
            "path": { "path": file_path },
            "mode": "read",
            "handleId": "handle-runtime"
        })))
        .expect("open should succeed after cancel");
        clear_runtime_resources("host.runtime.disconnect")
            .expect("runtime cleanup should release native filesystem resources");
        open(Some(json!({
            "path": { "path": file_path },
            "mode": "read",
            "handleId": "handle-runtime"
        })))
        .expect("open id should be reusable after runtime cleanup");
    }

    #[test]
    fn native_file_system_is_supported_reports_real_adapter() {
        let payload = is_supported()
            .expect("support payload should encode")
            .expect("support payload should be present");

        assert_eq!(payload, json!({ "supported": true }));
    }

    fn assert_event_phase(receiver: &Receiver<HostProtocolEnvelope>, phase: &str) {
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        loop {
            let now = std::time::Instant::now();
            assert!(
                now < deadline,
                "timed out waiting for native filesystem {phase} event"
            );
            let timeout = deadline.saturating_duration_since(now);
            let event = receiver
                .recv_timeout(timeout)
                .expect("native filesystem event should arrive");
            let HostProtocolEnvelope::Event {
                method, payload, ..
            } = event
            else {
                continue;
            };
            assert_eq!(method, host_protocol::NATIVE_FILE_SYSTEM_EVENT);
            if payload
                .as_ref()
                .and_then(|payload| payload.get("phase"))
                .and_then(|phase| phase.as_str())
                == Some(phase)
            {
                return;
            }
        }
    }

    struct TempFixture {
        root: std::path::PathBuf,
    }

    impl TempFixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("effect-desktop-native-fs-{}", Uuid::now_v7()));
            fs::create_dir_all(&root).expect("fixture directory should be created");
            Self { root }
        }

        fn path(&self, name: &str) -> std::path::PathBuf {
            self.root.join(name)
        }
    }

    impl Drop for TempFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

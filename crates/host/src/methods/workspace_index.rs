#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, WorkspaceIndexActorPayload, WorkspaceIndexClosePayload,
    WorkspaceIndexCloseResultPayload, WorkspaceIndexEventPayload, WorkspaceIndexEventPhase,
    WorkspaceIndexOpenPayload, WorkspaceIndexOpenResultPayload, WorkspaceIndexRefreshPayload,
    WorkspaceIndexRefreshResultPayload, WorkspaceIndexScopePayload, WorkspaceIndexState,
    WorkspaceIndexSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use uuid::Uuid;

const WATCH_UNSUPPORTED_REASON: &str = "workspace-index-watch-unimplemented";

pub(crate) type EventPayload = (&'static str, Value);
pub(crate) type EventfulResponse = Result<(Option<Value>, Vec<EventPayload>), HostProtocolError>;

#[derive(Clone)]
struct WorkspaceIndexSession {
    root: String,
    root_path: PathBuf,
    ignore_rules: Vec<String>,
    indexed_paths: BTreeSet<String>,
}

struct ScanResult {
    indexed_paths: BTreeSet<String>,
    ignored: u64,
}

struct RefreshResult {
    indexed_paths: Vec<String>,
    invalidated_paths: Vec<String>,
    ignored: u64,
    next_indexed_paths: BTreeSet<String>,
}

static WORKSPACE_INDEXES: OnceLock<Mutex<HashMap<String, WorkspaceIndexSession>>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn open(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    open_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn open_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<WorkspaceIndexOpenPayload>(
        payload,
        host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
    )?;
    validate_open(&input, host_protocol::WORKSPACE_INDEX_OPEN_METHOD)?;
    let operation = host_protocol::WORKSPACE_INDEX_OPEN_METHOD;
    let root_path = canonical_workspace_root(input.scope().root(), operation)?;
    validate_canonical_grant_coverage(input.scope(), &root_path, operation)?;
    let scan = scan_root(&root_path, input.scope(), operation)?;
    let index_id = input
        .index_id()
        .map(ToString::to_string)
        .unwrap_or_else(generate_index_id);
    let root = trim_trailing_separators(input.scope().root()).to_string();
    insert_session(
        index_id.clone(),
        WorkspaceIndexSession {
            root: root.clone(),
            root_path,
            ignore_rules: input
                .scope()
                .ignore_rules()
                .iter()
                .map(|rule| rule.pattern().to_string())
                .collect(),
            indexed_paths: scan.indexed_paths.clone(),
        },
        operation,
    )?;

    let mut events = vec![workspace_index_event(
        WorkspaceIndexEventPayload::new(
            timestamp,
            index_id.clone(),
            WorkspaceIndexEventPhase::Opened,
        )
        .with_root(root.clone(), WorkspaceIndexState::Opened),
        operation,
    )?];
    for path in &scan.indexed_paths {
        events.push(workspace_index_event(
            WorkspaceIndexEventPayload::new(
                timestamp,
                index_id.clone(),
                WorkspaceIndexEventPhase::EntryIndexed,
            )
            .with_path(path.clone()),
            operation,
        )?);
    }
    events.push(workspace_index_event(
        WorkspaceIndexEventPayload::new(
            timestamp,
            index_id.clone(),
            WorkspaceIndexEventPhase::RefreshCompleted,
        )
        .with_root(root.clone(), WorkspaceIndexState::Opened)
        .with_counts(scan.indexed_paths.len() as u64, 0, scan.ignored),
        operation,
    )?);

    Ok((
        encode_payload(
            WorkspaceIndexOpenResultPayload::opened(index_id, root),
            operation,
        )?,
        events,
    ))
}

#[cfg(test)]
pub(crate) fn refresh(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    refresh_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn refresh_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<WorkspaceIndexRefreshPayload>(
        payload,
        host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
    )?;
    validate_refresh(&input, host_protocol::WORKSPACE_INDEX_REFRESH_METHOD)?;
    let operation = host_protocol::WORKSPACE_INDEX_REFRESH_METHOD;
    let session = get_session(input.index_id(), operation)?;
    let refresh = refresh_session(&session, input.changed_paths(), operation)?;
    replace_indexed_paths(
        input.index_id(),
        refresh.next_indexed_paths.clone(),
        operation,
    )?;

    let mut events = vec![workspace_index_event(
        WorkspaceIndexEventPayload::new(
            timestamp,
            input.index_id(),
            WorkspaceIndexEventPhase::RefreshStarted,
        )
        .with_root(session.root.clone(), WorkspaceIndexState::Refreshing),
        operation,
    )?];
    for path in &refresh.indexed_paths {
        events.push(workspace_index_event(
            WorkspaceIndexEventPayload::new(
                timestamp,
                input.index_id(),
                WorkspaceIndexEventPhase::EntryIndexed,
            )
            .with_path(path.clone()),
            operation,
        )?);
    }
    for path in &refresh.invalidated_paths {
        events.push(workspace_index_event(
            WorkspaceIndexEventPayload::new(
                timestamp,
                input.index_id(),
                WorkspaceIndexEventPhase::EntryInvalidated,
            )
            .with_path(path.clone()),
            operation,
        )?);
    }
    events.push(workspace_index_event(
        WorkspaceIndexEventPayload::new(
            timestamp,
            input.index_id(),
            WorkspaceIndexEventPhase::RefreshCompleted,
        )
        .with_root(session.root.clone(), WorkspaceIndexState::Opened)
        .with_counts(
            refresh.indexed_paths.len() as u64,
            refresh.invalidated_paths.len() as u64,
            refresh.ignored,
        ),
        operation,
    )?);

    Ok((
        encode_payload(
            WorkspaceIndexRefreshResultPayload::new(
                input.index_id(),
                WorkspaceIndexState::Opened,
                refresh.indexed_paths.len() as u64,
                refresh.invalidated_paths.len() as u64,
                refresh.ignored,
            ),
            operation,
        )?,
        events,
    ))
}

#[cfg(test)]
pub(crate) fn close(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    close_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn close_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<WorkspaceIndexClosePayload>(
        payload,
        host_protocol::WORKSPACE_INDEX_CLOSE_METHOD,
    )?;
    validate_close(&input, host_protocol::WORKSPACE_INDEX_CLOSE_METHOD)?;
    let operation = host_protocol::WORKSPACE_INDEX_CLOSE_METHOD;
    let session = remove_session(input.index_id(), operation)?;
    Ok((
        encode_payload(
            WorkspaceIndexCloseResultPayload::closed(input.index_id()),
            operation,
        )?,
        vec![workspace_index_event(
            WorkspaceIndexEventPayload::new(
                timestamp,
                input.index_id(),
                WorkspaceIndexEventPhase::Closed,
            )
            .with_root(session.root, WorkspaceIndexState::Closed),
            operation,
        )?],
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        WorkspaceIndexSupportedPayload::supported(),
        host_protocol::WORKSPACE_INDEX_IS_SUPPORTED_METHOD,
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
            format!("failed to encode workspace index payload: {error}"),
            operation,
        )
    })
}

fn workspace_index_event<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<EventPayload, HostProtocolError> {
    to_value(payload)
        .map(|payload| (host_protocol::WORKSPACE_INDEX_EVENT, payload))
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode workspace index event payload: {error}"),
                operation,
            )
        })
}

fn insert_session(
    index_id: String,
    session: WorkspaceIndexSession,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    workspace_indexes(operation)?.insert(index_id, session);
    Ok(())
}

fn get_session(
    index_id: &str,
    operation: &'static str,
) -> Result<WorkspaceIndexSession, HostProtocolError> {
    workspace_indexes(operation)?
        .get(index_id)
        .cloned()
        .ok_or_else(|| {
            HostProtocolError::not_found(format!("workspace index {index_id}"), operation)
        })
}

fn replace_indexed_paths(
    index_id: &str,
    indexed_paths: BTreeSet<String>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut sessions = workspace_indexes(operation)?;
    let session = sessions.get_mut(index_id).ok_or_else(|| {
        HostProtocolError::not_found(format!("workspace index {index_id}"), operation)
    })?;
    session.indexed_paths = indexed_paths;
    Ok(())
}

fn remove_session(
    index_id: &str,
    operation: &'static str,
) -> Result<WorkspaceIndexSession, HostProtocolError> {
    workspace_indexes(operation)?
        .remove(index_id)
        .ok_or_else(|| {
            HostProtocolError::not_found(format!("workspace index {index_id}"), operation)
        })
}

fn workspace_indexes(
    operation: &'static str,
) -> Result<std::sync::MutexGuard<'static, HashMap<String, WorkspaceIndexSession>>, HostProtocolError>
{
    WORKSPACE_INDEXES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| {
            HostProtocolError::internal("workspace index session lock poisoned", operation)
        })
}

fn canonical_workspace_root(
    root: &str,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    let metadata =
        fs::symlink_metadata(root).map_err(|error| map_io_error(root, error, operation))?;
    if metadata.file_type().is_symlink() {
        return Err(symlink_escapes_root(
            root,
            root,
            &[root.to_string()],
            operation,
        ));
    }
    if !metadata.is_dir() {
        return Err(HostProtocolError::invalid_argument(
            "scope.root",
            "must reference an existing directory",
            operation,
        ));
    }
    fs::canonicalize(root).map_err(|error| map_io_error(root, error, operation))
}

fn validate_canonical_grant_coverage(
    scope: &WorkspaceIndexScopePayload,
    root_path: &Path,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut grant_roots = Vec::new();
    for grant in scope.grants() {
        if grant.get("kind").and_then(Value::as_str) != Some("filesystem.read") {
            continue;
        }
        let Some(roots) = grant.get("roots").and_then(Value::as_array) else {
            continue;
        };
        for root in roots.iter().filter_map(Value::as_str) {
            let canonical =
                fs::canonicalize(root).map_err(|error| map_io_error(root, error, operation))?;
            grant_roots.push(canonical);
        }
    }
    if grant_roots
        .iter()
        .any(|grant_root| path_contains_path(grant_root, root_path))
    {
        Ok(())
    } else {
        Err(HostProtocolError::invalid_argument(
            "scope.grants",
            "must include filesystem.read for canonical scope.root",
            operation,
        ))
    }
}

fn scan_root(
    root_path: &Path,
    scope: &WorkspaceIndexScopePayload,
    operation: &'static str,
) -> Result<ScanResult, HostProtocolError> {
    let mut result = ScanResult {
        indexed_paths: BTreeSet::new(),
        ignored: 0,
    };
    scan_entry(
        root_path,
        root_path,
        trim_trailing_separators(scope.root()),
        scope,
        &mut result,
        operation,
    )?;
    Ok(result)
}

fn scan_entry(
    root_path: &Path,
    path: &Path,
    display_root: &str,
    scope: &WorkspaceIndexScopePayload,
    result: &mut ScanResult,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| map_io_error(&path_to_string(path), error, operation))?;
    let canonical = if metadata.file_type().is_symlink() {
        let resolved = fs::canonicalize(path)
            .map_err(|error| map_io_error(&path_to_string(path), error, operation))?;
        if !path_contains_path(root_path, &resolved) {
            return Err(symlink_escapes_root(
                &path_to_string(path),
                &path_to_string(&resolved),
                &[path_to_string(root_path)],
                operation,
            ));
        }
        resolved
    } else {
        fs::canonicalize(path)
            .map_err(|error| map_io_error(&path_to_string(path), error, operation))?
    };
    if !path_contains_path(root_path, &canonical) {
        return Err(symlink_escapes_root(
            &path_to_string(path),
            &path_to_string(&canonical),
            &[path_to_string(root_path)],
            operation,
        ));
    }

    let path_string = display_path(root_path, display_root, path);
    if path != root_path && is_ignored(scope, root_path, path) {
        result.ignored += 1;
        return Ok(());
    }
    result.indexed_paths.insert(path_string);
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        let entries = fs::read_dir(path)
            .map_err(|error| map_io_error(&path_to_string(path), error, operation))?;
        for entry in entries {
            let entry =
                entry.map_err(|error| map_io_error(&path_to_string(path), error, operation))?;
            scan_entry(
                root_path,
                &entry.path(),
                display_root,
                scope,
                result,
                operation,
            )?;
        }
    }
    Ok(())
}

fn refresh_session(
    session: &WorkspaceIndexSession,
    changed_paths: &[String],
    operation: &'static str,
) -> Result<RefreshResult, HostProtocolError> {
    if changed_paths.is_empty() {
        let scope = scope_from_session(session);
        let scan = scan_root(&session.root_path, &scope, operation)?;
        let indexed_paths = scan
            .indexed_paths
            .difference(&session.indexed_paths)
            .cloned()
            .collect::<Vec<_>>();
        let invalidated_paths = session
            .indexed_paths
            .difference(&scan.indexed_paths)
            .cloned()
            .collect::<Vec<_>>();
        return Ok(RefreshResult {
            indexed_paths,
            invalidated_paths,
            ignored: scan.ignored,
            next_indexed_paths: scan.indexed_paths,
        });
    }

    let mut indexed_paths = Vec::new();
    let mut invalidated_paths = Vec::new();
    let mut ignored = 0;
    let mut next_indexed_paths = session.indexed_paths.clone();
    let scope = scope_from_session(session);
    for changed_path in changed_paths {
        let path = PathBuf::from(changed_path);
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                let canonical = fs::canonicalize(&path)
                    .map_err(|error| map_io_error(changed_path, error, operation))?;
                if !path_contains_path(&session.root_path, &canonical) {
                    return Err(symlink_escapes_root(
                        changed_path,
                        &path_to_string(&canonical),
                        std::slice::from_ref(&session.root),
                        operation,
                    ));
                }
                if is_ignored(&scope, &session.root_path, &canonical) {
                    ignored += 1;
                    continue;
                }
                if metadata.is_dir() && !metadata.file_type().is_symlink() {
                    let mut scan = ScanResult {
                        indexed_paths: BTreeSet::new(),
                        ignored: 0,
                    };
                    scan_entry(
                        &session.root_path,
                        &canonical,
                        &session.root,
                        &scope,
                        &mut scan,
                        operation,
                    )?;
                    let directory_path =
                        display_path(&session.root_path, &session.root, &canonical);
                    let stale_paths = next_indexed_paths
                        .iter()
                        .filter(|indexed_path| {
                            path_contains(&directory_path, indexed_path)
                                && !scan.indexed_paths.contains(*indexed_path)
                        })
                        .cloned()
                        .collect::<Vec<_>>();
                    for stale_path in &stale_paths {
                        next_indexed_paths.remove(stale_path);
                        invalidated_paths.push(stale_path.clone());
                    }
                    for indexed_path in &scan.indexed_paths {
                        next_indexed_paths.insert(indexed_path.clone());
                        indexed_paths.push(indexed_path.clone());
                    }
                    ignored += scan.ignored;
                } else {
                    let indexed_path = display_path(&session.root_path, &session.root, &canonical);
                    next_indexed_paths.insert(indexed_path.clone());
                    indexed_paths.push(indexed_path);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if !path_contains(&session.root, changed_path) {
                    return Err(HostProtocolError::invalid_argument(
                        "changedPaths",
                        "must stay inside the workspace root",
                        operation,
                    ));
                }
                if is_ignored(&scope, Path::new(&session.root), &path) {
                    ignored += 1;
                    continue;
                }
                let stale_paths = next_indexed_paths
                    .iter()
                    .filter(|indexed_path| {
                        indexed_path.as_str() == changed_path
                            || path_contains(changed_path, indexed_path)
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                if stale_paths.is_empty() {
                    invalidated_paths.push(changed_path.clone());
                } else {
                    for stale_path in stale_paths {
                        next_indexed_paths.remove(&stale_path);
                        invalidated_paths.push(stale_path);
                    }
                }
            }
            Err(error) => return Err(map_io_error(changed_path, error, operation)),
        }
    }
    Ok(RefreshResult {
        indexed_paths,
        invalidated_paths,
        ignored,
        next_indexed_paths,
    })
}

fn scope_from_session(session: &WorkspaceIndexSession) -> WorkspaceIndexScopePayload {
    WorkspaceIndexScopePayload::new(
        session.root.clone(),
        session
            .ignore_rules
            .iter()
            .map(|rule| host_protocol::WorkspaceIndexIgnoreRulePayload::new(rule, None))
            .collect(),
        vec![serde_json::json!({
            "kind": "filesystem.read",
            "roots": [session.root],
            "audit": "always"
        })],
        false,
    )
}

fn is_ignored(scope: &WorkspaceIndexScopePayload, root_path: &Path, path: &Path) -> bool {
    let relative = relative_to_root(root_path, path);
    scope
        .ignore_rules()
        .iter()
        .any(|rule| matches_ignore_rule(rule.pattern(), &relative))
}

fn matches_ignore_rule(pattern: &str, relative_path: &str) -> bool {
    let pattern = normalized_relative_path(pattern);
    if let Some(base) = pattern.strip_suffix("/**") {
        return relative_path == base || relative_path.starts_with(&format!("{base}/"));
    }
    if pattern.ends_with('/') {
        return relative_path.starts_with(&pattern);
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return relative_path.ends_with(suffix);
    }
    relative_path == pattern || relative_path.starts_with(&format!("{pattern}/"))
}

fn relative_to_root(root_path: &Path, path: &Path) -> String {
    path.strip_prefix(root_path)
        .map(path_to_string)
        .unwrap_or_else(|_| path_to_string(path))
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string()
}

fn normalized_relative_path(path: &str) -> String {
    path.replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn map_io_error(path: &str, error: io::Error, operation: &'static str) -> HostProtocolError {
    if error.kind() == io::ErrorKind::NotFound {
        HostProtocolError::not_found(path, operation)
    } else if error.kind() == io::ErrorKind::PermissionDenied {
        HostProtocolError::invalid_argument("path", format!("permission denied: {path}"), operation)
    } else {
        HostProtocolError::internal(
            format!("workspace index filesystem error at {path}: {error}"),
            operation,
        )
    }
}

fn symlink_escapes_root(
    requested: &str,
    resolved: &str,
    capability_roots: &[String],
    operation: &'static str,
) -> HostProtocolError {
    HostProtocolError::SymlinkEscapesRoot {
        requested: requested.to_string(),
        resolved: resolved.to_string(),
        capability_roots: capability_roots.to_vec(),
        message: format!("symlink resolved outside workspace root: {requested} -> {resolved}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("SymlinkEscapesRoot")
            .expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn path_to_string(path: &Path) -> String {
    path.display().to_string()
}

fn display_path(root_path: &Path, display_root: &str, path: &Path) -> String {
    if path == root_path {
        return display_root.to_string();
    }
    path.strip_prefix(root_path)
        .map(|relative| {
            let separator = display_separator(display_root);
            let separator_string = separator.to_string();
            let relative = path_to_string(relative).replace(['/', '\\'], &separator_string);
            format!(
                "{}{}{}",
                display_root.trim_end_matches(['/', '\\']),
                separator,
                relative
            )
        })
        .unwrap_or_else(|_| path_to_string(path))
}

fn display_separator(display_root: &str) -> char {
    if display_root.contains('\\') && !display_root.contains('/') {
        '\\'
    } else {
        '/'
    }
}

fn path_contains_path(parent: &Path, child: &Path) -> bool {
    child == parent || child.starts_with(parent)
}

fn generate_index_id() -> String {
    format!("workspace-index-{}", Uuid::new_v4())
}

fn validate_open(
    input: &WorkspaceIndexOpenPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_scope(input.scope(), operation)?;
    if input.scope().watch() {
        return Err(HostProtocolError::unsupported(
            WATCH_UNSUPPORTED_REASON,
            operation,
        ));
    }
    if let Some(index_id) = input.index_id() {
        validate_non_empty("indexId", index_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_refresh(
    input: &WorkspaceIndexRefreshPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("indexId", input.index_id(), operation)?;
    for changed_path in input.changed_paths() {
        validate_canonical_absolute_path("changedPaths", changed_path, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_close(
    input: &WorkspaceIndexClosePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("indexId", input.index_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &WorkspaceIndexActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_identifier("actor.id", actor.id(), operation)
}

fn validate_scope(
    scope: &WorkspaceIndexScopePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_canonical_absolute_path("scope.root", scope.root(), operation)?;
    if scope.grants().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "scope.grants",
            "must not be empty",
            operation,
        ));
    }
    if filesystem_read_grants_have_dot_segments(scope.grants()) {
        return Err(HostProtocolError::invalid_argument(
            "scope.grants",
            "filesystem.read roots must not include dot path segments",
            operation,
        ));
    }
    if !scope
        .grants()
        .iter()
        .any(|grant| grant_covers_root(grant, scope.root()))
    {
        return Err(HostProtocolError::invalid_argument(
            "scope.grants",
            "must include filesystem.read for scope.root",
            operation,
        ));
    }
    for rule in scope.ignore_rules() {
        validate_ignore_rule(rule.pattern(), operation)?;
    }
    Ok(())
}

fn grant_covers_root(grant: &Value, root: &str) -> bool {
    if grant.get("kind").and_then(Value::as_str) != Some("filesystem.read") {
        return false;
    }
    let Some(roots) = grant.get("roots").and_then(Value::as_array) else {
        return false;
    };
    roots
        .iter()
        .filter_map(Value::as_str)
        .any(|grant_root| path_contains(grant_root, root))
}

fn filesystem_read_grants_have_dot_segments(grants: &[Value]) -> bool {
    grants.iter().any(|grant| {
        grant.get("kind").and_then(Value::as_str) == Some("filesystem.read")
            && grant
                .get("roots")
                .and_then(Value::as_array)
                .is_some_and(|roots| {
                    roots
                        .iter()
                        .filter_map(Value::as_str)
                        .any(path_has_dot_segment)
                })
    })
}

fn path_contains(parent: &str, child: &str) -> bool {
    if path_has_dot_segment(parent) || path_has_dot_segment(child) {
        return false;
    }
    let parent = normalize_path_key(trim_trailing_separators(parent));
    let child = normalize_path_key(trim_trailing_separators(child));
    if parent == "/" {
        return child.starts_with('/');
    }
    child == parent
        || child
            .strip_prefix(&parent)
            .is_some_and(|suffix| suffix.starts_with('/') || suffix.starts_with('\\'))
}

fn normalize_path_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if is_windows_path(&normalized) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn is_windows_path(value: &str) -> bool {
    value.starts_with("//")
        || (value.len() >= 3
            && value.as_bytes()[1] == b':'
            && matches!(value.as_bytes()[2], b'/' | b'\\')
            && value.as_bytes()[0].is_ascii_alphabetic())
}

fn trim_trailing_separators(value: &str) -> &str {
    if value == "/" {
        return value;
    }
    value.trim_end_matches(['/', '\\'])
}

fn validate_ignore_rule(pattern: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    validate_non_empty("scope.ignoreRules.pattern", pattern, operation)?;
    if is_absolute_path(pattern)
        || pattern.starts_with("../")
        || pattern == ".."
        || pattern.contains("/../")
        || pattern.contains("\\..\\")
        || pattern.contains("://")
    {
        return Err(HostProtocolError::invalid_argument(
            "scope.ignoreRules.pattern",
            "must be a relative ignore pattern",
            operation,
        ));
    }
    Ok(())
}

fn validate_absolute_path(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty(field, value, operation)?;
    if !is_absolute_path(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an absolute path",
            operation,
        ));
    }
    Ok(())
}

fn validate_canonical_absolute_path(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_absolute_path(field, value, operation)?;
    if path_has_dot_segment(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include dot path segments",
            operation,
        ));
    }
    Ok(())
}

fn is_absolute_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("\\\\")
        || (value.len() >= 3
            && value.as_bytes()[1] == b':'
            && matches!(value.as_bytes()[2], b'/' | b'\\')
            && value.as_bytes()[0].is_ascii_alphabetic())
}

fn path_has_dot_segment(value: &str) -> bool {
    value
        .split(['/', '\\'])
        .any(|segment| matches!(segment, "." | ".."))
}

fn validate_identifier(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if !value
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must contain only letters, numbers, dot, underscore, or dash",
            operation,
        ));
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

#[cfg(test)]
mod tests {
    use super::{
        close, close_with_event, is_supported, open, open_with_event, refresh, refresh_with_event,
    };
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn open_indexes_existing_workspace_and_emits_initial_events() {
        let workspace = temp_workspace("open-indexes");
        fs::create_dir_all(workspace.join("src")).expect("src dir");
        fs::write(workspace.join("src/main.ts"), b"export {}\n").expect("source file");
        fs::create_dir_all(workspace.join("node_modules/pkg")).expect("ignored dir");
        fs::write(
            workspace.join("node_modules/pkg/index.js"),
            b"module.exports = {}\n",
        )
        .expect("ignored file");

        let (payload, events) = open_with_event(
            Some(valid_open_payload(&workspace, "workspace-index-open")),
            1_710_000_000_000,
        )
        .expect("workspace should open");

        assert_eq!(
            payload,
            Some(json!({
                "indexId": "workspace-index-open",
                "root": workspace.display().to_string(),
                "state": "opened"
            }))
        );
        assert!(events.iter().any(|(_, event)| event["phase"] == "opened"));
        assert!(events.iter().any(|(_, event)| {
            event["phase"] == "entry-indexed"
                && event["path"] == workspace.join("src/main.ts").display().to_string()
        }));
        assert!(events.iter().any(|(_, event)| {
            event["phase"] == "refresh-completed" && event["indexed"].as_u64().unwrap_or(0) >= 2
        }));
    }

    #[test]
    fn refresh_indexes_changed_paths_and_invalidates_removed_paths() {
        let workspace = temp_workspace("refresh-indexes");
        fs::create_dir_all(workspace.join("src")).expect("src dir");
        let source = workspace.join("src/main.ts");
        fs::write(&source, b"export const value = 1\n").expect("source file");
        open(Some(valid_open_payload(
            &workspace,
            "workspace-index-refresh",
        )))
        .expect("workspace should open");

        fs::remove_file(&source).expect("source file removed");
        let missing = source.display().to_string();
        let payload = refresh(Some(json!({
            "indexId": "workspace-index-refresh",
            "changedPaths": [missing]
        })))
        .expect("refresh should succeed");

        assert_eq!(
            payload,
            Some(json!({
                "indexId": "workspace-index-refresh",
                "state": "opened",
                "indexed": 0,
                "invalidated": 1,
                "ignored": 0
            }))
        );
    }

    #[test]
    fn refresh_skips_deleted_ignored_path_instead_of_invalidating() {
        let workspace = temp_workspace("refresh-deleted-ignored");
        fs::create_dir_all(workspace.join("src")).expect("src dir");
        fs::write(workspace.join("src/main.ts"), b"export const value = 1\n").expect("source file");
        fs::create_dir_all(workspace.join("node_modules/pkg")).expect("ignored dir");
        let ignored = workspace.join("node_modules/pkg/index.js");
        fs::write(&ignored, b"module.exports = {}\n").expect("ignored file");
        open(Some(valid_open_payload(
            &workspace,
            "workspace-index-deleted-ignored",
        )))
        .expect("workspace should open");

        fs::remove_file(&ignored).expect("ignored file removed");
        let (payload, events) = refresh_with_event(
            Some(json!({
                "indexId": "workspace-index-deleted-ignored",
                "changedPaths": [ignored.display().to_string()]
            })),
            1_710_000_000_050,
        )
        .expect("refresh should succeed");

        assert_eq!(
            payload,
            Some(json!({
                "indexId": "workspace-index-deleted-ignored",
                "state": "opened",
                "indexed": 0,
                "invalidated": 0,
                "ignored": 1
            }))
        );
        assert!(!events.iter().any(|(_, event)| {
            event["phase"] == "entry-invalidated" && event["path"] == ignored.display().to_string()
        }));
    }

    #[test]
    fn refresh_emits_index_invalidation_and_completion_events() {
        let workspace = temp_workspace("refresh-events");
        fs::create_dir_all(workspace.join("src")).expect("src dir");
        let removed = workspace.join("src/old.ts");
        let added = workspace.join("src/new.ts");
        fs::write(&removed, b"export const old = 1\n").expect("old source");
        open(Some(valid_open_payload(
            &workspace,
            "workspace-index-refresh-events",
        )))
        .expect("workspace should open");

        fs::remove_file(&removed).expect("old source removed");
        fs::write(&added, b"export const next = 1\n").expect("new source");
        let (payload, events) = refresh_with_event(
            Some(json!({
                "indexId": "workspace-index-refresh-events",
                "changedPaths": [
                    removed.display().to_string(),
                    added.display().to_string()
                ],
                "traceId": "trace-refresh-events"
            })),
            1_710_000_000_100,
        )
        .expect("refresh should succeed");

        assert_eq!(
            payload,
            Some(json!({
                "indexId": "workspace-index-refresh-events",
                "state": "opened",
                "indexed": 1,
                "invalidated": 1,
                "ignored": 0
            }))
        );
        assert!(events.iter().any(|(_, event)| {
            event["phase"] == "refresh-started" && event["state"] == "refreshing"
        }));
        assert!(events.iter().any(|(_, event)| {
            event["phase"] == "entry-indexed" && event["path"] == added.display().to_string()
        }));
        assert!(events.iter().any(|(_, event)| {
            event["phase"] == "entry-invalidated" && event["path"] == removed.display().to_string()
        }));
        assert!(events.iter().any(|(_, event)| {
            event["phase"] == "refresh-completed"
                && event["indexed"] == 1
                && event["invalidated"] == 1
                && event["ignored"] == 0
        }));
    }

    #[test]
    fn refresh_directory_invalidates_removed_descendants() {
        let workspace = temp_workspace("refresh-directory-invalidates");
        let src = workspace.join("src");
        fs::create_dir_all(&src).expect("src dir");
        let removed = src.join("old.ts");
        fs::write(&removed, b"export const old = 1\n").expect("old source");
        open(Some(valid_open_payload(
            &workspace,
            "workspace-index-directory-refresh",
        )))
        .expect("workspace should open");

        fs::remove_file(&removed).expect("old source removed");
        let (payload, events) = refresh_with_event(
            Some(json!({
                "indexId": "workspace-index-directory-refresh",
                "changedPaths": [src.display().to_string()]
            })),
            1_710_000_000_200,
        )
        .expect("directory refresh should succeed");

        assert_eq!(
            payload,
            Some(json!({
                "indexId": "workspace-index-directory-refresh",
                "state": "opened",
                "indexed": 1,
                "invalidated": 1,
                "ignored": 0
            }))
        );
        assert!(events.iter().any(|(_, event)| {
            event["phase"] == "entry-invalidated" && event["path"] == removed.display().to_string()
        }));
    }

    #[test]
    fn refresh_rejects_out_of_root_changed_paths_before_filesystem_reads() {
        let workspace = temp_workspace("refresh-out-of-root");
        open(Some(valid_open_payload(
            &workspace,
            "workspace-index-out-of-root",
        )))
        .expect("workspace should open");
        let outside = workspace
            .parent()
            .expect("workspace parent")
            .join("outside.ts")
            .display()
            .to_string();

        let error = refresh(Some(json!({
            "indexId": "workspace-index-out-of-root",
            "changedPaths": [outside]
        })))
        .expect_err("out-of-root changed path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "changedPaths",
                "must stay inside the workspace root",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[test]
    fn refresh_after_close_returns_typed_not_found() {
        let workspace = temp_workspace("refresh-after-close");
        open(Some(valid_open_payload(
            &workspace,
            "workspace-index-closed",
        )))
        .expect("workspace should open");
        close(Some(json!({ "indexId": "workspace-index-closed" }))).expect("close should succeed");

        let error = refresh(Some(json!({
            "indexId": "workspace-index-closed",
            "changedPaths": [workspace.join("src/main.ts").display().to_string()]
        })))
        .expect_err("closed index must fail");

        assert_eq!(
            error,
            HostProtocolError::not_found(
                "workspace index workspace-index-closed",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[test]
    fn close_emits_closed_event_and_releases_session() {
        let workspace = temp_workspace("close-events");
        open(Some(valid_open_payload(
            &workspace,
            "workspace-index-close-events",
        )))
        .expect("workspace should open");

        let (payload, events) = close_with_event(
            Some(json!({
                "indexId": "workspace-index-close-events",
                "traceId": "trace-close-events"
            })),
            1_710_000_000_300,
        )
        .expect("close should succeed");

        assert_eq!(
            payload,
            Some(json!({
                "indexId": "workspace-index-close-events",
                "closed": true
            }))
        );
        assert!(events.iter().any(|(_, event)| {
            event["phase"] == "closed"
                && event["state"] == "closed"
                && event["root"] == workspace.display().to_string()
        }));

        let error = refresh(Some(json!({
            "indexId": "workspace-index-close-events",
            "changedPaths": [workspace.join("src/main.ts").display().to_string()]
        })))
        .expect_err("closed index must be released");

        assert_eq!(
            error,
            HostProtocolError::not_found(
                "workspace index workspace-index-close-events",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[cfg(unix)]
    #[test]
    fn open_rejects_symlink_escape_before_indexing() {
        use std::os::unix::fs::symlink;

        let workspace = temp_workspace("symlink-escape");
        let outside = temp_workspace("symlink-outside");
        fs::write(outside.join("secret.txt"), b"secret\n").expect("outside file");
        symlink(outside.join("secret.txt"), workspace.join("secret-link"))
            .expect("symlink should be created");

        let error = open(Some(valid_open_payload(
            &workspace,
            "workspace-index-symlink",
        )))
        .expect_err("escaping symlink must fail");

        assert!(matches!(
            error,
            HostProtocolError::SymlinkEscapesRoot { .. }
        ));
    }

    #[test]
    fn open_rejects_relative_root_before_filesystem_access() {
        let mut payload = valid_open_payload(&temp_workspace("relative-root"), "workspace-index-1");
        payload["scope"]["root"] = json!("workspace/app");
        let error = open(Some(payload)).expect_err("relative root must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.root",
                "must be an absolute path",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_dot_segment_root_before_filesystem_access() {
        let workspace = temp_workspace("dot-root");
        let mut payload = valid_open_payload(&workspace, "workspace-index-1");
        payload["scope"]["root"] = json!(format!("{}/../secret", workspace.display()));
        let error = open(Some(payload)).expect_err("dot-segment root must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.root",
                "must not include dot path segments",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_missing_filesystem_read_grant_before_filesystem_access() {
        let workspace = temp_workspace("missing-grant");
        let mut payload = valid_open_payload(&workspace, "workspace-index-1");
        payload["scope"]["grants"] = json!([
            {
                "kind": "process.spawn",
                "commands": ["/bin/ls"],
                "audit": "always"
            }
        ]);
        let error = open(Some(payload)).expect_err("missing filesystem grant must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.grants",
                "must include filesystem.read for scope.root",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_watch_true_until_host_watcher_exists() {
        let workspace = temp_workspace("watch-unsupported");
        let mut payload = valid_open_payload(&workspace, "workspace-index-watch");
        payload["scope"]["watch"] = json!(true);
        let error = open(Some(payload)).expect_err("watch mode must fail explicitly");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                "workspace-index-watch-unimplemented",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_dot_segment_grant_root_before_filesystem_access() {
        let workspace = temp_workspace("dot-grant");
        let mut payload = valid_open_payload(&workspace, "workspace-index-1");
        payload["scope"]["grants"][0]["roots"] = json!([format!("{}/..", workspace.display())]);
        let error = open(Some(payload)).expect_err("dot-segment grant root must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.grants",
                "filesystem.read roots must not include dot path segments",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_absolute_ignore_rule_before_filesystem_access() {
        let workspace = temp_workspace("absolute-ignore");
        let mut payload = valid_open_payload(&workspace, "workspace-index-1");
        payload["scope"]["ignoreRules"][0]["pattern"] = json!("/tmp/**");
        let error = open(Some(payload)).expect_err("absolute ignore rule must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.ignoreRules.pattern",
                "must be a relative ignore pattern",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn refresh_rejects_empty_index_id_before_session_lookup() {
        let error = refresh(Some(json!({
            "indexId": "",
            "changedPaths": ["/workspace/app/src/main.ts"]
        })))
        .expect_err("empty index id must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "indexId",
                "must be non-empty",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[test]
    fn refresh_rejects_relative_changed_path_before_session_lookup() {
        let error = refresh(Some(json!({
            "indexId": "workspace-index-1",
            "changedPaths": ["src/main.ts"]
        })))
        .expect_err("relative changed path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "changedPaths",
                "must be an absolute path",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[test]
    fn refresh_rejects_dot_segment_changed_path_before_session_lookup() {
        let error = refresh(Some(json!({
            "indexId": "workspace-index-1",
            "changedPaths": ["/workspace/app/../secret.ts"]
        })))
        .expect_err("dot-segment changed path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "changedPaths",
                "must not include dot path segments",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[test]
    fn is_supported_returns_supported_status() {
        let payload = is_supported().expect("support payload should encode");

        assert_eq!(payload, Some(json!({ "supported": true })));
    }

    fn valid_open_payload(workspace: &Path, index_id: &str) -> serde_json::Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "scope": {
                "root": workspace.display().to_string(),
                "ignoreRules": [
                    { "pattern": "node_modules/**", "reason": "dependencies" }
                ],
                "grants": [
                    {
                        "kind": "filesystem.read",
                        "roots": [workspace.display().to_string()],
                        "audit": "always"
                    }
                ],
                "watch": false
            },
            "indexId": index_id,
            "traceId": "trace-workspace-index"
        })
    }

    fn temp_workspace(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("effect-desktop-workspace-index-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp workspace should be created");
        dir
    }
}

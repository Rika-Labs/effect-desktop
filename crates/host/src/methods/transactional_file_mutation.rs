#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, HostProtocolPlatform, TransactionalFileMutationActorKind,
    TransactionalFileMutationActorPayload, TransactionalFileMutationCommitPayload,
    TransactionalFileMutationCommitResultPayload, TransactionalFileMutationDiffPayload,
    TransactionalFileMutationPreparePayload, TransactionalFileMutationPrepareResultPayload,
    TransactionalFileMutationRollbackPayload, TransactionalFileMutationRollbackResultPayload,
    TransactionalFileMutationSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, to_value, Value};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use uuid::Uuid;

#[derive(Clone)]
struct PreparedMutation {
    actor: TransactionalFileMutationActorPayload,
    path: String,
    owner_scope: String,
    source_hash: String,
    replacement_bytes: Vec<u8>,
    state: PreparedMutationState,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum PreparedMutationState {
    Prepared,
    Committing,
    RollingBack,
    Conflicted,
}

static PREPARED_MUTATIONS: OnceLock<Mutex<HashMap<String, PreparedMutation>>> = OnceLock::new();

pub(crate) fn prepare(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransactionalFileMutationPreparePayload>(
        payload,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
    )?;
    validate_prepare(
        &input,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
    )?;
    let operation = host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD;
    let source = read_file(input.path(), operation)?;
    let source_hash = hash_bytes(&source);
    if let Some(expected_source_hash) = input.expected_source_hash() {
        validate_expected_hash(&source_hash, expected_source_hash, operation)?;
    }

    let mutation_id = input
        .mutation_id()
        .map(ToString::to_string)
        .unwrap_or_else(generate_mutation_id);
    let owner_scope = input
        .owner_scope()
        .map(ToString::to_string)
        .unwrap_or_else(|| mutation_owner_scope(input.actor()));
    let replacement_bytes = input.replacement_bytes().to_vec();
    let replacement_hash = hash_bytes(&replacement_bytes);
    let diff = make_diff(input.path(), &source, &replacement_bytes);

    let mutation = PreparedMutation {
        actor: input.actor().clone(),
        path: input.path().to_string(),
        owner_scope: owner_scope.clone(),
        source_hash: source_hash.clone(),
        replacement_bytes,
        state: PreparedMutationState::Prepared,
    };
    insert_prepared_mutation(mutation_id.clone(), mutation, operation)?;

    encode_payload(
        TransactionalFileMutationPrepareResultPayload::prepared(
            mutation_id,
            input.path(),
            owner_scope,
            source_hash,
            replacement_hash,
            diff,
        ),
        operation,
    )
}

pub(crate) fn commit(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransactionalFileMutationCommitPayload>(
        payload,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
    )?;
    validate_commit(
        &input,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
    )?;
    let operation = host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD;
    let mutation = claim_prepared_mutation(
        input.mutation_id(),
        input.actor(),
        PreparedMutationState::Committing,
        operation,
    )?;
    if let Some(expected_source_hash) = input.expected_source_hash() {
        if let Err(error) =
            validate_expected_hash(&mutation.source_hash, expected_source_hash, operation)
        {
            restore_prepared_mutation(
                input.mutation_id(),
                mutation,
                PreparedMutationState::Prepared,
                operation,
            )?;
            return Err(error);
        }
    }

    let current_source = match fs::read(&mutation.path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            let host_error = map_io_error(&mutation.path, error, operation, "read");
            restore_prepared_mutation(
                input.mutation_id(),
                mutation,
                PreparedMutationState::Prepared,
                operation,
            )?;
            return Err(host_error);
        }
    };
    let current_hash = current_source
        .as_deref()
        .map(hash_bytes)
        .unwrap_or_else(|| "missing".to_string());
    if current_hash != mutation.source_hash {
        let error = invalid_state(current_hash, mutation.source_hash.clone(), operation);
        restore_prepared_mutation(
            input.mutation_id(),
            mutation,
            PreparedMutationState::Conflicted,
            operation,
        )?;
        return Err(error);
    }

    if let Err(error) = write_replacement_atomically(
        &mutation.path,
        input.mutation_id(),
        &mutation.source_hash,
        &mutation.replacement_bytes,
    ) {
        let restore_state = if matches!(error, HostProtocolError::InvalidState { .. }) {
            PreparedMutationState::Conflicted
        } else {
            PreparedMutationState::Prepared
        };
        restore_prepared_mutation(input.mutation_id(), mutation, restore_state, operation)?;
        return Err(error);
    }
    remove_prepared_mutation(input.mutation_id(), operation)?;

    encode_payload(
        TransactionalFileMutationCommitResultPayload::committed(input.mutation_id(), mutation.path),
        operation,
    )
}

pub(crate) fn rollback(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransactionalFileMutationRollbackPayload>(
        payload,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
    )?;
    validate_rollback(
        &input,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
    )?;
    let operation = host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD;
    let mutation = claim_prepared_mutation(
        input.mutation_id(),
        input.actor(),
        PreparedMutationState::RollingBack,
        operation,
    )?;
    remove_prepared_mutation(input.mutation_id(), operation)?;

    encode_payload(
        TransactionalFileMutationRollbackResultPayload::rolled_back(
            input.mutation_id(),
            mutation.path,
        ),
        operation,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        TransactionalFileMutationSupportedPayload::supported(),
        host_protocol::TRANSACTIONAL_FILE_MUTATION_IS_SUPPORTED_METHOD,
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
            format!("failed to encode transactional file mutation payload: {error}"),
            operation,
        )
    })
}

fn prepared_mutations() -> &'static Mutex<HashMap<String, PreparedMutation>> {
    PREPARED_MUTATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn insert_prepared_mutation(
    mutation_id: String,
    mutation: PreparedMutation,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut mutations = lock_prepared_mutations(operation)?;
    if mutations.contains_key(&mutation_id) {
        return Err(HostProtocolError::invalid_argument(
            "mutationId",
            "must identify a mutation that is not already prepared",
            operation,
        ));
    }
    mutations.insert(mutation_id, mutation);
    Ok(())
}

fn claim_prepared_mutation(
    mutation_id: &str,
    actor: &TransactionalFileMutationActorPayload,
    next_state: PreparedMutationState,
    operation: &'static str,
) -> Result<PreparedMutation, HostProtocolError> {
    let mut mutations = lock_prepared_mutations(operation)?;
    let mutation = mutations
        .get_mut(mutation_id)
        .ok_or_else(|| HostProtocolError::not_found(mutation_resource(mutation_id), operation))?;
    validate_actor_matches(actor, &mutation.actor, operation)?;
    if !can_claim_mutation(mutation.state, next_state) {
        return Err(invalid_claim_state(
            mutation.state,
            next_state,
            &mutation.owner_scope,
            operation,
        ));
    }
    mutation.state = next_state;
    Ok(mutation.clone())
}

fn restore_prepared_mutation(
    mutation_id: &str,
    mut mutation: PreparedMutation,
    state: PreparedMutationState,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    mutation.state = state;
    let mut mutations = lock_prepared_mutations(operation)?;
    mutations.insert(mutation_id.to_string(), mutation);
    Ok(())
}

fn can_claim_mutation(current: PreparedMutationState, next: PreparedMutationState) -> bool {
    match next {
        PreparedMutationState::Committing => current == PreparedMutationState::Prepared,
        PreparedMutationState::RollingBack => {
            current == PreparedMutationState::Prepared
                || current == PreparedMutationState::Conflicted
        }
        PreparedMutationState::Prepared | PreparedMutationState::Conflicted => false,
    }
}

fn state_name(state: PreparedMutationState) -> &'static str {
    match state {
        PreparedMutationState::Prepared => "prepared",
        PreparedMutationState::Committing => "committing",
        PreparedMutationState::RollingBack => "rolling-back",
        PreparedMutationState::Conflicted => "conflicted",
    }
}

fn invalid_claim_state(
    current: PreparedMutationState,
    attempted: PreparedMutationState,
    owner_scope: &str,
    operation: &'static str,
) -> HostProtocolError {
    let current = state_name(current).to_string();
    let attempted = state_name(attempted).to_string();
    HostProtocolError::InvalidState {
        message: format!("invalid state transition from {current} to {attempted}"),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: None,
        cause: Some(json!({
            "current": current.clone(),
            "attempted": attempted.clone(),
            "ownerScope": owner_scope
        })),
        recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
        remediation: None,
        docs_url: None,
        current,
        attempted,
    }
}

fn remove_prepared_mutation(
    mutation_id: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut mutations = lock_prepared_mutations(operation)?;
    mutations.remove(mutation_id);
    Ok(())
}

fn lock_prepared_mutations(
    operation: &'static str,
) -> Result<std::sync::MutexGuard<'static, HashMap<String, PreparedMutation>>, HostProtocolError> {
    prepared_mutations().lock().map_err(|_| {
        HostProtocolError::internal("transactional mutation registry lock poisoned", operation)
    })
}

fn read_file(path: &str, operation: &'static str) -> Result<Vec<u8>, HostProtocolError> {
    fs::read(path).map_err(|error| map_io_error(path, error, operation, "read"))
}

fn validate_expected_hash(
    current: &str,
    expected: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if current == expected {
        return Ok(());
    }
    Err(invalid_state(current, expected, operation))
}

fn validate_actor_matches(
    actor: &TransactionalFileMutationActorPayload,
    expected: &TransactionalFileMutationActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if actor == expected {
        return Ok(());
    }
    Err(HostProtocolError::invalid_argument(
        "actor",
        "must match the actor that prepared the mutation",
        operation,
    ))
}

fn write_replacement_atomically(
    path: &str,
    mutation_id: &str,
    expected_source_hash: &str,
    replacement_bytes: &[u8],
) -> Result<(), HostProtocolError> {
    let operation = host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD;
    let path_buf = PathBuf::from(path);
    let parent = path_buf.parent().ok_or_else(|| {
        HostProtocolError::invalid_argument("path", "must include a parent directory", operation)
    })?;
    let temp_path = temporary_replacement_path(parent, &path_buf, mutation_id);
    let source_path = temporary_source_path(parent, &path_buf, mutation_id);
    let write_result = write_temp_file(&temp_path, replacement_bytes, operation).and_then(|()| {
        run_before_source_capture_test_hook();
        capture_source_for_replacement(path, &source_path, expected_source_hash, operation)?;
        if let Err(error) = validate_source_file_hash(
            &source_path.display().to_string(),
            expected_source_hash,
            operation,
        ) {
            let _ = restore_captured_source(path, &source_path, operation);
            return Err(error);
        }
        run_before_replacement_create_test_hook();
        if let Err(error) = create_replacement_at_empty_path(
            &temp_path,
            Path::new(path),
            expected_source_hash,
            operation,
        ) {
            let _ = restore_captured_source(path, &source_path, operation);
            return Err(error);
        }
        let _ = fs::remove_file(&source_path);
        Ok(())
    });
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn capture_source_for_replacement(
    path: &str,
    source_path: &Path,
    expected_source_hash: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    fs::rename(path, source_path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            invalid_state("missing", expected_source_hash, operation)
        } else {
            map_io_error(path, error, operation, "rename")
        }
    })
}

fn create_replacement_at_empty_path(
    temp_path: &Path,
    path: &Path,
    expected_source_hash: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match fs::hard_link(temp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(temp_path);
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let path = path.display().to_string();
            let current_hash = read_source_hash(&path, operation)?;
            Err(invalid_state(current_hash, expected_source_hash, operation))
        }
        Err(error) => Err(map_io_error(
            &path.display().to_string(),
            error,
            operation,
            "link",
        )),
    }
}

fn restore_captured_source(
    path: &str,
    source_path: &Path,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match fs::hard_link(source_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(source_path);
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let _ = fs::remove_file(source_path);
            Ok(())
        }
        Err(error) => Err(map_io_error(path, error, operation, "restore")),
    }
}

fn validate_source_file_hash(
    path: &str,
    expected_source_hash: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let current_hash = read_source_hash(path, operation)?;
    validate_expected_hash(&current_hash, expected_source_hash, operation)
}

fn read_source_hash(path: &str, operation: &'static str) -> Result<String, HostProtocolError> {
    let current_source = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(map_io_error(path, error, operation, "read")),
    };
    Ok(current_source
        .as_deref()
        .map(hash_bytes)
        .unwrap_or_else(|| "missing".to_string()))
}

#[cfg(test)]
type FileReplacementTestHook = Box<dyn FnOnce() + 'static>;

#[cfg(test)]
thread_local! {
    static BEFORE_SOURCE_CAPTURE_HOOK: std::cell::RefCell<Option<FileReplacementTestHook>> =
        std::cell::RefCell::new(None);
    static BEFORE_REPLACEMENT_CREATE_HOOK: std::cell::RefCell<Option<FileReplacementTestHook>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn install_before_source_capture_test_hook(hook: impl FnOnce() + 'static) {
    BEFORE_SOURCE_CAPTURE_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(test)]
fn install_before_replacement_create_test_hook(hook: impl FnOnce() + 'static) {
    BEFORE_REPLACEMENT_CREATE_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(test)]
fn run_before_source_capture_test_hook() {
    let hook = BEFORE_SOURCE_CAPTURE_HOOK.with(|slot| slot.borrow_mut().take());
    if let Some(hook) = hook {
        hook();
    }
}

#[cfg(not(test))]
fn run_before_source_capture_test_hook() {}

#[cfg(test)]
fn run_before_replacement_create_test_hook() {
    let hook = BEFORE_REPLACEMENT_CREATE_HOOK.with(|slot| slot.borrow_mut().take());
    if let Some(hook) = hook {
        hook();
    }
}

#[cfg(not(test))]
fn run_before_replacement_create_test_hook() {}

fn write_temp_file(
    temp_path: &Path,
    replacement_bytes: &[u8],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut temp_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp_path)
        .map_err(|error| {
            map_io_error(&temp_path.display().to_string(), error, operation, "open")
        })?;
    temp_file.write_all(replacement_bytes).map_err(|error| {
        map_io_error(&temp_path.display().to_string(), error, operation, "write")
    })?;
    temp_file.sync_all().map_err(|error| {
        map_io_error(&temp_path.display().to_string(), error, operation, "sync")
    })?;
    Ok(())
}

fn temporary_replacement_path(parent: &Path, path: &Path, mutation_id: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    parent.join(format!(
        ".{file_name}.effect-desktop-{}.tmp",
        sanitize_path_segment(mutation_id)
    ))
}

fn temporary_source_path(parent: &Path, path: &Path, mutation_id: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    parent.join(format!(
        ".{file_name}.effect-desktop-{}.source",
        sanitize_path_segment(mutation_id)
    ))
}

fn sanitize_path_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn mutation_owner_scope(actor: &TransactionalFileMutationActorPayload) -> String {
    format!(
        "transactional-file-mutation-{}-{}",
        actor_kind_wire_name(actor.kind()),
        actor.id()
    )
}

fn actor_kind_wire_name(kind: TransactionalFileMutationActorKind) -> &'static str {
    match kind {
        TransactionalFileMutationActorKind::Workspace => "workspace",
        TransactionalFileMutationActorKind::Extension => "extension",
        TransactionalFileMutationActorKind::Tool => "tool",
        TransactionalFileMutationActorKind::Process => "process",
        TransactionalFileMutationActorKind::Native => "native",
        TransactionalFileMutationActorKind::App => "app",
        TransactionalFileMutationActorKind::Window => "window",
    }
}

fn make_diff(
    path: &str,
    source_bytes: &[u8],
    replacement_bytes: &[u8],
) -> TransactionalFileMutationDiffPayload {
    let source_text = String::from_utf8_lossy(source_bytes);
    let replacement_text = String::from_utf8_lossy(replacement_bytes);
    let source_lines = split_lines_like_javascript(&source_text);
    let replacement_lines = split_lines_like_javascript(&replacement_text);
    let mut lines = Vec::with_capacity(source_lines.len() + replacement_lines.len() + 3);
    lines.push(format!("--- {path}"));
    lines.push(format!("+++ {path}"));
    lines.push(format!(
        "@@ -1,{} +1,{} @@",
        source_lines.len(),
        replacement_lines.len()
    ));
    lines.extend(source_lines.iter().map(|line| format!("-{line}")));
    lines.extend(replacement_lines.iter().map(|line| format!("+{line}")));
    TransactionalFileMutationDiffPayload::unified(
        lines.join("\n"),
        replacement_lines.len() as u64,
        source_lines.len() as u64,
    )
}

fn split_lines_like_javascript(value: &str) -> Vec<&str> {
    value.split('\n').collect()
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hash = 2_166_136_261_u32;
    for byte in bytes {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("fnv1a-{hash:08x}")
}

fn generate_mutation_id() -> String {
    format!("file-mutation-{}", Uuid::new_v4())
}

fn mutation_resource(mutation_id: &str) -> String {
    format!("TransactionalFileMutation:{mutation_id}")
}

fn map_io_error(
    path: &str,
    error: io::Error,
    operation: &'static str,
    action: &str,
) -> HostProtocolError {
    match error.kind() {
        io::ErrorKind::NotFound => file_not_found(path, operation, action, &error),
        io::ErrorKind::PermissionDenied => permission_denied(path, operation, action, &error),
        io::ErrorKind::AlreadyExists => already_exists(path, operation, action, &error),
        _ => internal_io_error(path, operation, action, &error),
    }
}

fn file_not_found(
    path: &str,
    operation: &'static str,
    action: &str,
    error: &io::Error,
) -> HostProtocolError {
    HostProtocolError::FileNotFound {
        path: path.to_string(),
        message: format!("file not found: {path}"),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: io_error_code(error),
        cause: Some(io_error_cause(action, error)),
        recoverable: HostProtocolError::recoverable_default("FileNotFound").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn permission_denied(
    path: &str,
    operation: &'static str,
    action: &str,
    error: &io::Error,
) -> HostProtocolError {
    let capability = if action == "read" {
        "filesystem.read"
    } else {
        "filesystem.write"
    };
    HostProtocolError::PermissionDenied {
        capability: capability.to_string(),
        resource: Some(path.to_string()),
        message: format!("permission denied: {path}"),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: io_error_code(error),
        cause: Some(io_error_cause(action, error)),
        recoverable: HostProtocolError::recoverable_default("PermissionDenied").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn already_exists(
    path: &str,
    operation: &'static str,
    action: &str,
    error: &io::Error,
) -> HostProtocolError {
    HostProtocolError::AlreadyExists {
        resource: path.to_string(),
        message: format!("resource already exists: {path}"),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: io_error_code(error),
        cause: Some(io_error_cause(action, error)),
        recoverable: HostProtocolError::recoverable_default("AlreadyExists").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn internal_io_error(
    path: &str,
    operation: &'static str,
    action: &str,
    error: &io::Error,
) -> HostProtocolError {
    HostProtocolError::Internal {
        message: format!("failed to {action} {path}: {error}"),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: io_error_code(error),
        cause: Some(io_error_cause(action, error)),
        recoverable: HostProtocolError::recoverable_default("Internal").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn invalid_state(
    current: impl Into<String>,
    attempted: impl Into<String>,
    operation: &'static str,
) -> HostProtocolError {
    let current = current.into();
    let attempted = attempted.into();
    HostProtocolError::InvalidState {
        message: format!("invalid state transition from {current} to {attempted}"),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: None,
        cause: Some(json!({
            "current": current.clone(),
            "attempted": attempted.clone()
        })),
        recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
        remediation: None,
        docs_url: None,
        current,
        attempted,
    }
}

fn current_platform() -> HostProtocolPlatform {
    #[cfg(target_os = "macos")]
    {
        HostProtocolPlatform::Macos
    }
    #[cfg(target_os = "windows")]
    {
        HostProtocolPlatform::Windows
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        HostProtocolPlatform::Linux
    }
}

fn io_error_code(error: &io::Error) -> Option<String> {
    error.raw_os_error().map(|code| code.to_string())
}

fn io_error_cause(action: &str, error: &io::Error) -> Value {
    json!({
        "action": action,
        "kind": format!("{:?}", error.kind()),
        "message": error.to_string()
    })
}

fn validate_prepare(
    input: &TransactionalFileMutationPreparePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_canonical_absolute_path("path", input.path(), operation)?;
    if let Some(expected_source_hash) = input.expected_source_hash() {
        validate_non_empty("expectedSourceHash", expected_source_hash, operation)?;
    }
    if let Some(mutation_id) = input.mutation_id() {
        validate_non_empty("mutationId", mutation_id, operation)?;
    }
    if let Some(owner_scope) = input.owner_scope() {
        validate_non_empty("ownerScope", owner_scope, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_commit(
    input: &TransactionalFileMutationCommitPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_non_empty("mutationId", input.mutation_id(), operation)?;
    if let Some(expected_source_hash) = input.expected_source_hash() {
        validate_non_empty("expectedSourceHash", expected_source_hash, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_rollback(
    input: &TransactionalFileMutationRollbackPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_non_empty("mutationId", input.mutation_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &TransactionalFileMutationActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_identifier("actor.id", actor.id(), operation)
}

fn validate_canonical_absolute_path(
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
    if cfg!(windows) {
        is_windows_drive_absolute_path(value)
    } else {
        value.starts_with('/')
    }
}

fn is_windows_drive_absolute_path(value: &str) -> bool {
    value.len() >= 3
        && value.as_bytes()[1] == b':'
        && matches!(value.as_bytes()[2], b'/' | b'\\')
        && value.as_bytes()[0].is_ascii_alphabetic()
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
        commit, hash_bytes, install_before_replacement_create_test_hook,
        install_before_source_capture_test_hook, is_supported, prepare, rollback,
    };
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn prepare_reads_file_and_returns_prepared_payload() {
        let path = temp_file("prepare", b"source\n");
        let source_hash = hash_bytes(b"source\n");
        let replacement_hash = hash_bytes(b"next\n");
        let payload = prepare(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": path.display().to_string(),
            "replacementBytes": [110, 101, 120, 116, 10],
            "expectedSourceHash": source_hash,
            "mutationId": "file-mutation-prepare",
            "ownerScope": "scope-workspace",
            "traceId": "trace-prepare"
        })))
        .expect("prepare should succeed");

        assert_eq!(
            payload,
            Some(json!({
                "mutationId": "file-mutation-prepare",
                "path": path.display().to_string(),
                "state": "prepared",
                "ownerScope": "scope-workspace",
                "sourceHash": source_hash,
                "replacementHash": replacement_hash,
                "diff": {
                    "format": "unified",
                    "text": format!(
                        "--- {}\n+++ {}\n@@ -1,2 +1,2 @@\n-source\n-\n+next\n+",
                        path.display(),
                        path.display()
                    ),
                    "additions": 2,
                    "deletions": 2
                }
            }))
        );
        let owner_scope = super::prepared_mutations()
            .lock()
            .expect("test registry lock should be available")
            .get("file-mutation-prepare")
            .expect("prepared mutation should be registered")
            .owner_scope
            .clone();
        assert_eq!(owner_scope, "scope-workspace");
        rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-prepare"
        })))
        .expect("cleanup rollback should succeed");
        cleanup_path(path);
    }

    #[test]
    fn prepare_accepts_bridge_base64_replacement_bytes() {
        let path = temp_file("prepare-base64", b"source\n");
        let replacement_hash = hash_bytes(b"next\n");
        let payload = prepare(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": path.display().to_string(),
            "replacementBytes": "bmV4dAo=",
            "mutationId": "file-mutation-prepare-base64"
        })))
        .expect("prepare should accept bridge-encoded replacement bytes");

        assert_eq!(
            payload
                .as_ref()
                .and_then(|value| value.get("replacementHash"))
                .and_then(|value| value.as_str()),
            Some(replacement_hash.as_str())
        );
        rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-prepare-base64"
        })))
        .expect("cleanup rollback should succeed");
        cleanup_path(path);
    }

    #[test]
    fn commit_replaces_file_when_source_hash_matches() {
        let path = temp_file("commit", b"source\n");
        prepare(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": path.display().to_string(),
            "replacementBytes": [110, 101, 120, 116, 10],
            "mutationId": "file-mutation-commit"
        })))
        .expect("prepare should succeed");

        let payload = commit(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-commit"
        })))
        .expect("commit should succeed");

        assert_eq!(fs::read(&path).expect("file should exist"), b"next\n");
        assert_eq!(
            payload,
            Some(json!({
                "mutationId": "file-mutation-commit",
                "path": path.display().to_string(),
                "state": "committed",
                "committed": true
            }))
        );
        cleanup_path(path);
    }

    #[test]
    fn commit_rejects_stale_source_without_dropping_prepared_mutation() {
        let path = temp_file("stale", b"source\n");
        let source_hash = hash_bytes(b"source\n");
        let changed_hash = hash_bytes(b"changed\n");
        prepare(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": path.display().to_string(),
            "replacementBytes": [110, 101, 120, 116, 10],
            "mutationId": "file-mutation-stale"
        })))
        .expect("prepare should succeed");
        fs::write(&path, b"changed\n").expect("file should be changed");

        let error = commit(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-stale"
        })))
        .expect_err("stale source should fail");

        assert_eq!(
            error,
            super::invalid_state(
                changed_hash,
                source_hash,
                host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
            )
        );
        let second_commit_error = commit(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-stale"
        })))
        .expect_err("conflicted mutation should not be committable again");
        assert_eq!(
            second_commit_error,
            super::invalid_claim_state(
                super::PreparedMutationState::Conflicted,
                super::PreparedMutationState::Committing,
                "transactional-file-mutation-workspace-workspace-1",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
            )
        );
        rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-stale"
        })))
        .expect("prepared mutation should still be rollbackable");
        cleanup_path(path);
    }

    #[test]
    fn commit_rejects_source_change_between_temp_write_and_capture() {
        let path = temp_file("late-stale", b"source\n");
        let source_hash = hash_bytes(b"source\n");
        let changed_hash = hash_bytes(b"changed\n");
        prepare(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": path.display().to_string(),
            "replacementBytes": [110, 101, 120, 116, 10],
            "mutationId": "file-mutation-late-stale"
        })))
        .expect("prepare should succeed");
        let stale_path = path.clone();
        install_before_source_capture_test_hook(move || {
            fs::write(&stale_path, b"changed\n").expect("file should be changed before capture");
        });

        let error = commit(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-late-stale"
        })))
        .expect_err("late source change should fail");

        assert_eq!(
            error,
            super::invalid_state(
                changed_hash,
                source_hash,
                host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
            )
        );
        assert_eq!(fs::read(&path).expect("file should exist"), b"changed\n");
        rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-late-stale"
        })))
        .expect("conflicted mutation should be rollbackable");
        cleanup_path(path);
    }

    #[test]
    fn commit_rejects_source_recreated_between_capture_and_replacement() {
        let path = temp_file("recreated-stale", b"source\n");
        let source_hash = hash_bytes(b"source\n");
        let changed_hash = hash_bytes(b"changed\n");
        prepare(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": path.display().to_string(),
            "replacementBytes": [110, 101, 120, 116, 10],
            "mutationId": "file-mutation-recreated-stale"
        })))
        .expect("prepare should succeed");
        let stale_path = path.clone();
        install_before_replacement_create_test_hook(move || {
            fs::write(&stale_path, b"changed\n").expect("file should be recreated before replace");
        });

        let error = commit(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-recreated-stale"
        })))
        .expect_err("recreated source should fail");

        assert_eq!(
            error,
            super::invalid_state(
                changed_hash,
                source_hash,
                host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
            )
        );
        assert_eq!(fs::read(&path).expect("file should exist"), b"changed\n");
        rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-recreated-stale"
        })))
        .expect("conflicted mutation should be rollbackable");
        cleanup_path(path);
    }

    #[test]
    fn rollback_drops_prepared_mutation_without_touching_file() {
        let path = temp_file("rollback", b"source\n");
        prepare(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": path.display().to_string(),
            "replacementBytes": [110, 101, 120, 116, 10],
            "mutationId": "file-mutation-rollback"
        })))
        .expect("prepare should succeed");

        let payload = rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-rollback",
            "traceId": "trace-rollback"
        })))
        .expect("rollback should succeed");

        assert_eq!(fs::read(&path).expect("file should exist"), b"source\n");
        assert_eq!(
            payload,
            Some(json!({
                "mutationId": "file-mutation-rollback",
                "path": path.display().to_string(),
                "state": "rolled-back",
                "rolledBack": true
            }))
        );
        cleanup_path(path);
    }

    #[test]
    fn prepare_rejects_duplicate_mutation_id() {
        let path = temp_file("duplicate", b"source\n");
        let payload = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": path.display().to_string(),
            "replacementBytes": [110, 101, 120, 116, 10],
            "mutationId": "file-mutation-duplicate"
        });
        prepare(Some(payload.clone())).expect("first prepare should succeed");
        let error = prepare(Some(payload)).expect_err("duplicate mutation id should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "mutationId",
                "must identify a mutation that is not already prepared",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
        rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-duplicate"
        })))
        .expect("cleanup rollback should succeed");
        cleanup_path(path);
    }

    #[test]
    fn prepare_file_errors_include_platform_code_and_cause() {
        let missing_path = unique_temp_dir("missing").join("missing.txt");
        let error = prepare(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": missing_path.display().to_string(),
            "replacementBytes": [110, 101, 120, 116, 10],
            "mutationId": "file-mutation-missing"
        })))
        .expect_err("missing file should fail");

        match error {
            HostProtocolError::FileNotFound {
                platform,
                code,
                cause,
                ..
            } => {
                assert!(platform.is_some());
                assert!(code.is_some());
                assert_eq!(
                    cause.and_then(|value| value.get("action").cloned()),
                    Some(json!("read"))
                );
            }
            other => panic!("expected FileNotFound, got {other:?}"),
        }
    }

    #[test]
    fn prepare_rejects_relative_path_before_reading_file() {
        let mut payload = valid_prepare_payload();
        payload["path"] = json!("workspace/app/src/main.ts");
        let error = prepare(Some(payload)).expect_err("relative path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "path",
                "must be an absolute path",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn prepare_rejects_windows_drive_path_on_unix_before_reading_file() {
        let mut payload = valid_prepare_payload();
        payload["path"] = json!("C:/workspace/app/src/main.ts");
        let error = prepare(Some(payload)).expect_err("drive path must fail on Unix");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "path",
                "must be an absolute path",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[cfg(windows)]
    #[test]
    fn prepare_rejects_current_drive_root_path_on_windows_before_reading_file() {
        let mut payload = valid_prepare_payload();
        payload["path"] = json!("/workspace/app/src/main.ts");
        let error = prepare(Some(payload)).expect_err("current-drive-rooted path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "path",
                "must be an absolute path",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn prepare_rejects_dot_segment_path_before_reading_file() {
        let mut payload = valid_prepare_payload();
        payload["path"] = json!("/workspace/app/../secret.ts");
        let error = prepare(Some(payload)).expect_err("dot-segment path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "path",
                "must not include dot path segments",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn prepare_rejects_unc_path_before_reading_file() {
        let mut payload = valid_prepare_payload();
        payload["path"] = json!("\\\\server\\share\\file.txt");
        let error = prepare(Some(payload)).expect_err("unc path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "path",
                "must be an absolute path",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn prepare_rejects_invalid_actor_before_reading_file() {
        let mut payload = valid_prepare_payload();
        payload["actor"]["id"] = json!("workspace/1");
        let error = prepare(Some(payload)).expect_err("invalid actor id must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "actor.id",
                "must contain only letters, numbers, dot, underscore, or dash",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn prepare_rejects_empty_owner_scope_before_reading_file() {
        let mut payload = valid_prepare_payload();
        payload["ownerScope"] = json!(" ");
        let error = prepare(Some(payload)).expect_err("empty owner scope must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "ownerScope",
                "must be non-empty",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn commit_rejects_empty_mutation_id_before_registry_lookup() {
        let error = commit(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": ""
        })))
        .expect_err("empty mutation id must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "mutationId",
                "must be non-empty",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
            )
        );
    }

    #[test]
    fn rollback_returns_not_found_for_unknown_mutation() {
        let error = rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-unknown",
            "traceId": "trace-rollback"
        })))
        .expect_err("unknown mutation should fail");

        assert_eq!(
            error,
            HostProtocolError::not_found(
                "TransactionalFileMutation:file-mutation-unknown",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
            )
        );
    }

    #[test]
    fn is_supported_returns_supported_status() {
        let payload = is_supported().expect("support payload should encode");

        assert_eq!(
            payload,
            Some(json!({
                "supported": true
            }))
        );
    }

    fn valid_prepare_payload() -> serde_json::Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": "/workspace/app/src/main.ts",
            "replacementBytes": [110, 101, 120, 116, 10],
            "expectedSourceHash": "fnv1a-source",
            "mutationId": "file-mutation-1",
            "ownerScope": "scope-workspace",
            "traceId": "trace-prepare"
        })
    }

    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let dir = unique_temp_dir(name);
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let path = dir.join(format!("{name}.txt"));
        fs::write(&path, bytes).expect("temp file should be written");
        path
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("effect-desktop-file-mutation-{nanos}-{name}"))
    }

    fn cleanup_path(path: PathBuf) {
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}

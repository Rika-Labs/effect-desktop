#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::methods::open_intent;
use crate::window::WindowMethodHandler;
use host_protocol::HostProtocolError;
use host_protocol::{
    AppQuitPayload, AppRestartPayload, AppSecondInstanceEventPayload, AppSingleInstancePayload,
    HostProtocolEnvelope,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{to_value, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
        Arc, LazyLock, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tracing::{info, warn};
use uuid::Uuid;

#[cfg(unix)]
use std::os::fd::AsRawFd;

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::HANDLE;
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    LockFileEx, UnlockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
};
#[cfg(windows)]
use windows_sys::Win32::System::IO::OVERLAPPED;

const SINGLE_INSTANCE_LOCK_PATH_ENV: &str = "EFFECT_DESKTOP_SINGLE_INSTANCE_LOCK_PATH";
const SINGLE_INSTANCE_APP_ID_ENV: &str = "EFFECT_DESKTOP_APP_ID";
const SINGLE_INSTANCE_SMOKE_HOLD_MS_ENV: &str = "EFFECT_DESKTOP_SINGLE_INSTANCE_SMOKE_HOLD_MS";
const SINGLE_INSTANCE_LOCK_DIR: &str = "effect-desktop-single-instance";
const SINGLE_INSTANCE_SMOKE_OPERATION: &str = "App.requestSingleInstanceLock.smoke";
const SINGLE_INSTANCE_HANDOFF_BIND_ADDR: &str = "127.0.0.1:0";
const SINGLE_INSTANCE_HANDOFF_CONNECT_HOST: &str = "127.0.0.1";
const SINGLE_INSTANCE_HANDOFF_POLL_MS: u64 = 20;
const SINGLE_INSTANCE_LOCK_METADATA_READ_ATTEMPTS: usize = 20;
const SINGLE_INSTANCE_LOCK_METADATA_RETRY_MS: u64 = 10;
#[cfg(windows)]
const WINDOWS_SINGLE_INSTANCE_LOCK_OFFSET_HIGH: u32 = 1;
#[cfg(windows)]
const WINDOWS_SINGLE_INSTANCE_LOCK_LENGTH: u32 = 1;

static SINGLE_INSTANCE_LOCK: LazyLock<Mutex<Option<SingleInstanceLock>>> =
    LazyLock::new(|| Mutex::new(None));

pub(crate) fn quit(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(payload.as_ref(), "exitCode", host_protocol::APP_QUIT_METHOD)?;
    let input = decode_payload::<AppQuitPayload>(payload, host_protocol::APP_QUIT_METHOD)?;
    handler.quit(input.exit_code().unwrap_or(0))?;
    Ok(None)
}

pub(crate) fn restart(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(payload.as_ref(), "args", host_protocol::APP_RESTART_METHOD)?;
    let input = decode_payload::<AppRestartPayload>(payload, host_protocol::APP_RESTART_METHOD)?;
    validate_args(input.args(), host_protocol::APP_RESTART_METHOD)?;
    handler.restart(input.args().unwrap_or(&[]))?;
    Ok(None)
}

pub(crate) fn focus(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::APP_FOCUS_METHOD)?;
    let current = handler.get_current()?;
    handler.focus(current.window_id())?;
    Ok(None)
}

pub(crate) fn request_single_instance_lock(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    request_single_instance_lock_with_event_sender(payload, None)
}

pub(crate) fn request_single_instance_lock_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(
        payload,
        host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
    )?;
    acquire_single_instance_lock(
        host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
        event_sender,
    )
}

pub(crate) fn run_single_instance_lock_smoke() -> Result<(), HostProtocolError> {
    let payload = request_single_instance_lock(None)?.ok_or_else(|| {
        HostProtocolError::internal(
            "single-instance smoke missing payload",
            SINGLE_INSTANCE_SMOKE_OPERATION,
        )
    })?;
    let result =
        serde_json::from_value::<AppSingleInstancePayload>(payload.clone()).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to decode single-instance smoke payload: {error}"),
                SINGLE_INSTANCE_SMOKE_OPERATION,
            )
        })?;
    info!(
        event = "host.app.single_instance_lock.smoke_verified",
        acquired = result.is_acquired(),
        primary_pid = result.primary_pid(),
        payload = %payload,
        "single-instance lock smoke verified"
    );

    if let Some(hold) = single_instance_smoke_hold_duration()? {
        std::thread::sleep(hold);
    }
    Ok(())
}

fn reject_unexpected_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        )),
    }
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

fn validate_args(
    args: Option<&[String]>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(args) = args else {
        return Ok(());
    };
    for argument in args {
        if argument.is_empty() {
            return Err(HostProtocolError::invalid_argument(
                "args",
                "entries must be non-empty",
                operation,
            ));
        }
        if argument.contains('\0') {
            return Err(HostProtocolError::invalid_argument(
                "args",
                "entries must not contain NUL bytes",
                operation,
            ));
        }
    }
    Ok(())
}

struct SingleInstanceLock {
    handoff: Option<SingleInstanceHandoffServer>,
    file: File,
}

impl Drop for SingleInstanceLock {
    fn drop(&mut self) {
        self.handoff.take();
        unlock_single_instance_file(&self.file);
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SingleInstanceLockFile {
    primary_pid: u64,
    handoff: Option<SingleInstanceHandoffEndpoint>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SingleInstanceHandoffEndpoint {
    host: String,
    port: u16,
    token: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SingleInstanceHandoffMessage {
    token: String,
    event: AppSecondInstanceEventPayload,
}

struct SingleInstanceHandoffServer {
    endpoint: SingleInstanceHandoffEndpoint,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl SingleInstanceHandoffServer {
    fn endpoint(&self) -> SingleInstanceHandoffEndpoint {
        self.endpoint.clone()
    }
}

impl Drop for SingleInstanceHandoffServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        let address = format!("{}:{}", self.endpoint.host, self.endpoint.port);
        if let Ok(stream) = TcpStream::connect(address) {
            let _ = stream.shutdown(Shutdown::Both);
        }
        if let Some(handle) = self.handle.take() {
            if handle.join().is_err() {
                warn!(
                    event = "host.app.single_instance_handoff.thread_join_failed",
                    "single-instance handoff listener thread panicked"
                );
            }
        }
    }
}

fn acquire_single_instance_lock(
    operation: &'static str,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let mut current = SINGLE_INSTANCE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("single-instance lock state is poisoned", operation)
    })?;
    if let Some(lock) = current.as_mut() {
        refresh_single_instance_handoff(lock, event_sender, operation)?;
        return encode_single_instance(AppSingleInstancePayload::acquired(), operation);
    }

    let path = single_instance_lock_path(operation)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to create single-instance lock directory: {error}"),
                operation,
            )
        })?;
    }

    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to open single-instance lock file: {error}"),
                operation,
            )
        })?;
    restrict_single_instance_lock_file(&file, operation)?;

    if !try_lock_single_instance_file(&file, operation)? {
        let lock_file = read_single_instance_lock_file(&mut file, operation)?;
        if let Some(endpoint) = lock_file.handoff {
            let event = current_second_instance_event(operation)?;
            send_second_instance_handoff(&endpoint, event, operation)?;
        }
        return encode_single_instance(
            AppSingleInstancePayload::owned_by(lock_file.primary_pid),
            operation,
        );
    }

    let primary_pid = u64::from(std::process::id());
    let handoff = match event_sender {
        Some(sender) => Some(start_single_instance_handoff_server(sender, operation)?),
        None => None,
    };
    let lock_file = SingleInstanceLockFile {
        primary_pid,
        handoff: handoff.as_ref().map(SingleInstanceHandoffServer::endpoint),
    };
    write_single_instance_lock_file(&mut file, &lock_file, operation)?;
    *current = Some(SingleInstanceLock { handoff, file });
    encode_single_instance(AppSingleInstancePayload::acquired(), operation)
}

fn refresh_single_instance_handoff(
    lock: &mut SingleInstanceLock,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(sender) = event_sender else {
        return Ok(());
    };
    let handoff = start_single_instance_handoff_server(sender, operation)?;
    let lock_file = SingleInstanceLockFile {
        primary_pid: u64::from(std::process::id()),
        handoff: Some(handoff.endpoint()),
    };
    write_single_instance_lock_file(&mut lock.file, &lock_file, operation)?;
    lock.handoff = Some(handoff);
    Ok(())
}

fn encode_single_instance(
    payload: AppSingleInstancePayload,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode single-instance result: {error}"),
            operation,
        )
    })
}

fn single_instance_lock_path(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if let Some(path) = std::env::var_os(SINGLE_INSTANCE_LOCK_PATH_ENV).map(PathBuf::from) {
        return Ok(path);
    }

    let key = single_instance_key(operation)?;
    Ok(std::env::temp_dir()
        .join(SINGLE_INSTANCE_LOCK_DIR)
        .join(format!("{key}.lock")))
}

fn single_instance_key(operation: &'static str) -> Result<String, HostProtocolError> {
    let identity = match std::env::var(SINGLE_INSTANCE_APP_ID_ENV) {
        Ok(value) if !value.is_empty() => value,
        Ok(_) | Err(std::env::VarError::NotPresent) => std::env::current_exe()
            .map_err(|error| {
                HostProtocolError::internal(
                    format!(
                        "failed to resolve current executable for single-instance key: {error}"
                    ),
                    operation,
                )
            })?
            .display()
            .to_string(),
        Err(error) => {
            return Err(HostProtocolError::internal(
                format!("failed to read {SINGLE_INSTANCE_APP_ID_ENV}: {error}"),
                operation,
            ));
        }
    };

    let digest = Sha256::digest(identity.as_bytes());
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn single_instance_smoke_hold_duration() -> Result<Option<Duration>, HostProtocolError> {
    let Some(value) = std::env::var_os(SINGLE_INSTANCE_SMOKE_HOLD_MS_ENV) else {
        return Ok(None);
    };
    let value = value.to_string_lossy();
    let milliseconds = value.parse::<u64>().map_err(|error| {
        HostProtocolError::invalid_argument(
            SINGLE_INSTANCE_SMOKE_HOLD_MS_ENV,
            format!("must be a non-negative integer millisecond duration: {error}"),
            SINGLE_INSTANCE_SMOKE_OPERATION,
        )
    })?;
    Ok(Some(Duration::from_millis(milliseconds)))
}

#[cfg(unix)]
fn restrict_single_instance_lock_file(
    file: &File,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = file
        .metadata()
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to read single-instance lock file permissions: {error}"),
                operation,
            )
        })?
        .permissions();
    permissions.set_mode(0o600);
    file.set_permissions(permissions).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to restrict single-instance lock file permissions: {error}"),
            operation,
        )
    })
}

#[cfg(not(unix))]
fn restrict_single_instance_lock_file(
    _file: &File,
    _operation: &'static str,
) -> Result<(), HostProtocolError> {
    Ok(())
}

fn write_single_instance_lock_file(
    file: &mut File,
    lock_file: &SingleInstanceLockFile,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let encoded = serde_json::to_string(lock_file).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode single-instance lock metadata: {error}"),
            operation,
        )
    })?;
    file.set_len(0).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to truncate single-instance lock file: {error}"),
            operation,
        )
    })?;
    file.seek(SeekFrom::Start(0)).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to seek single-instance lock file: {error}"),
            operation,
        )
    })?;
    writeln!(file, "{encoded}").map_err(|error| {
        HostProtocolError::internal(
            format!("failed to write single-instance lock metadata: {error}"),
            operation,
        )
    })?;
    file.sync_data().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to sync single-instance primary pid: {error}"),
            operation,
        )
    })
}

fn read_single_instance_lock_file(
    file: &mut File,
    operation: &'static str,
) -> Result<SingleInstanceLockFile, HostProtocolError> {
    let mut last_invalid = "is empty".to_string();
    for attempt in 0..=SINGLE_INSTANCE_LOCK_METADATA_READ_ATTEMPTS {
        let mut buffer = String::new();
        file.seek(SeekFrom::Start(0)).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to seek single-instance lock file: {error}"),
                operation,
            )
        })?;
        file.read_to_string(&mut buffer).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to read single-instance primary pid: {error}"),
                operation,
            )
        })?;
        let trimmed = buffer.trim();
        if let Ok(lock_file) = serde_json::from_str::<SingleInstanceLockFile>(trimmed) {
            return Ok(lock_file);
        }
        if !trimmed.is_empty() {
            match trimmed.parse::<u64>() {
                Ok(primary_pid) => {
                    return Ok(SingleInstanceLockFile {
                        primary_pid,
                        handoff: None,
                    });
                }
                Err(error) => {
                    last_invalid = format!("primary pid is invalid: {error}");
                }
            }
        }
        if attempt < SINGLE_INSTANCE_LOCK_METADATA_READ_ATTEMPTS {
            thread::sleep(Duration::from_millis(
                SINGLE_INSTANCE_LOCK_METADATA_RETRY_MS,
            ));
        }
    }
    Err(HostProtocolError::internal(
        format!("single-instance lock metadata {last_invalid}"),
        operation,
    ))
}

fn start_single_instance_handoff_server(
    sender: Sender<HostProtocolEnvelope>,
    operation: &'static str,
) -> Result<SingleInstanceHandoffServer, HostProtocolError> {
    let listener = TcpListener::bind(SINGLE_INSTANCE_HANDOFF_BIND_ADDR).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to bind single-instance handoff listener: {error}"),
            operation,
        )
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to configure single-instance handoff listener: {error}"),
            operation,
        )
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to read single-instance handoff listener address: {error}"),
                operation,
            )
        })?
        .port();
    let endpoint = SingleInstanceHandoffEndpoint {
        host: SINGLE_INSTANCE_HANDOFF_CONNECT_HOST.to_string(),
        port,
        token: Uuid::now_v7().to_string(),
    };
    let shutdown = Arc::new(AtomicBool::new(false));
    let thread_shutdown = Arc::clone(&shutdown);
    let thread_token = endpoint.token.clone();
    let handle = thread::Builder::new()
        .name("effect-desktop-single-instance-handoff".to_string())
        .spawn(move || {
            run_single_instance_handoff_server(listener, sender, thread_token, thread_shutdown);
        })
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to start single-instance handoff listener: {error}"),
                operation,
            )
        })?;
    Ok(SingleInstanceHandoffServer {
        endpoint,
        shutdown,
        handle: Some(handle),
    })
}

fn run_single_instance_handoff_server(
    listener: TcpListener,
    sender: Sender<HostProtocolEnvelope>,
    token: String,
    shutdown: Arc<AtomicBool>,
) {
    while !shutdown.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, _address)) => {
                handle_single_instance_handoff_stream(stream, &sender, &token);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(SINGLE_INSTANCE_HANDOFF_POLL_MS));
            }
            Err(error) => {
                warn!(
                    event = "host.app.single_instance_handoff.accept_failed",
                    error = %error,
                    "failed to accept single-instance handoff"
                );
                thread::sleep(Duration::from_millis(SINGLE_INSTANCE_HANDOFF_POLL_MS));
            }
        }
    }
}

fn handle_single_instance_handoff_stream(
    mut stream: TcpStream,
    sender: &Sender<HostProtocolEnvelope>,
    token: &str,
) {
    let mut buffer = String::new();
    if let Err(error) = stream.read_to_string(&mut buffer) {
        warn!(
            event = "host.app.single_instance_handoff.read_failed",
            error = %error,
            "failed to read single-instance handoff"
        );
        return;
    }
    let message = match serde_json::from_str::<SingleInstanceHandoffMessage>(&buffer) {
        Ok(message) => message,
        Err(error) => {
            warn!(
                event = "host.app.single_instance_handoff.decode_failed",
                error = %error,
                "failed to decode single-instance handoff"
            );
            return;
        }
    };
    if message.token != token {
        warn!(
            event = "host.app.single_instance_handoff.invalid_token",
            "rejected single-instance handoff with invalid token"
        );
        return;
    }
    let trace_id = message.event.trace_id().to_string();
    let payload = match serde_json::to_value(message.event) {
        Ok(payload) => payload,
        Err(error) => {
            warn!(
                event = "host.app.single_instance_handoff.encode_failed",
                error = %error,
                "failed to encode single-instance handoff event"
            );
            return;
        }
    };
    if sender
        .send(HostProtocolEnvelope::Event {
            method: host_protocol::APP_SECOND_INSTANCE_EVENT.to_string(),
            timestamp: timestamp_millis(),
            trace_id,
            window_id: None,
            payload: Some(payload),
        })
        .is_err()
    {
        warn!(
            event = "host.app.single_instance_handoff.emit_failed",
            "failed to emit single-instance handoff event"
        );
    }
}

fn send_second_instance_handoff(
    endpoint: &SingleInstanceHandoffEndpoint,
    event: AppSecondInstanceEventPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let address = format!("{}:{}", endpoint.host, endpoint.port);
    let mut stream = TcpStream::connect(&address).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to connect to primary single-instance handoff endpoint: {error}"),
            operation,
        )
    })?;
    let message = SingleInstanceHandoffMessage {
        token: endpoint.token.clone(),
        event,
    };
    serde_json::to_writer(&mut stream, &message).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode single-instance handoff: {error}"),
            operation,
        )
    })?;
    stream.shutdown(Shutdown::Write).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to finish single-instance handoff: {error}"),
            operation,
        )
    })
}

fn current_second_instance_event(
    operation: &'static str,
) -> Result<AppSecondInstanceEventPayload, HostProtocolError> {
    let argv = std::env::args_os()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let cwd = std::env::current_dir().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to read second-instance current directory: {error}"),
            operation,
        )
    })?;
    Ok(AppSecondInstanceEventPayload::new(
        open_intent::app_activation_reason(&argv),
        argv,
        cwd.to_string_lossy(),
        format!("app-second-instance-{}", Uuid::now_v7()),
    ))
}

fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time should be after Unix epoch")
        .as_millis()
        .try_into()
        .expect("timestamp milliseconds should fit in u64")
}

#[cfg(unix)]
fn try_lock_single_instance_file(
    file: &File,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    let status = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if status == 0 {
        return Ok(true);
    }

    let error = std::io::Error::last_os_error();
    if matches!(error.raw_os_error(), Some(code) if code == libc::EWOULDBLOCK || code == libc::EAGAIN)
    {
        return Ok(false);
    }

    Err(HostProtocolError::internal(
        format!("failed to lock single-instance file: {error}"),
        operation,
    ))
}

#[cfg(unix)]
fn unlock_single_instance_file(file: &File) {
    let _ = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
}

#[cfg(windows)]
fn try_lock_single_instance_file(
    file: &File,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    let mut overlapped = windows_single_instance_lock_overlapped();
    let status = unsafe {
        LockFileEx(
            file.as_raw_handle() as HANDLE,
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            WINDOWS_SINGLE_INSTANCE_LOCK_LENGTH,
            0,
            &mut overlapped,
        )
    };
    if status != 0 {
        return Ok(true);
    }

    let error = std::io::Error::last_os_error();
    if matches!(error.raw_os_error(), Some(code) if code == windows_sys::Win32::Foundation::ERROR_LOCK_VIOLATION as i32)
    {
        return Ok(false);
    }

    Err(HostProtocolError::internal(
        format!("failed to lock single-instance file: {error}"),
        operation,
    ))
}

#[cfg(windows)]
fn unlock_single_instance_file(file: &File) {
    let mut overlapped = windows_single_instance_lock_overlapped();
    let _ = unsafe {
        UnlockFileEx(
            file.as_raw_handle() as HANDLE,
            0,
            WINDOWS_SINGLE_INSTANCE_LOCK_LENGTH,
            0,
            &mut overlapped,
        )
    };
}

#[cfg(windows)]
fn windows_single_instance_lock_overlapped() -> OVERLAPPED {
    let mut overlapped = OVERLAPPED::default();
    unsafe {
        overlapped.Anonymous.Anonymous.Offset = 0;
        overlapped.Anonymous.Anonymous.OffsetHigh = WINDOWS_SINGLE_INSTANCE_LOCK_OFFSET_HIGH;
    }
    overlapped
}

#[cfg(not(any(unix, windows)))]
fn try_lock_single_instance_file(
    _file: &File,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    Err(unsupported(operation))
}

#[cfg(not(any(unix, windows)))]
fn unlock_single_instance_file(_file: &File) {}

#[cfg(test)]
mod tests {
    use super::{
        read_single_instance_lock_file, request_single_instance_lock,
        request_single_instance_lock_with_event_sender, restart, send_second_instance_handoff,
        SingleInstanceHandoffEndpoint, SINGLE_INSTANCE_LOCK, SINGLE_INSTANCE_LOCK_PATH_ENV,
    };
    use crate::methods::tests::FakeWindowHandler;
    use host_protocol::{
        AppActivationReasonPayload, AppSecondInstanceEventPayload, HostProtocolEnvelope,
        HostProtocolError,
    };
    use serde_json::{json, Value};
    use std::fs::OpenOptions;
    use std::path::PathBuf;
    use std::sync::{mpsc, LazyLock, Mutex, MutexGuard};

    static SINGLE_INSTANCE_TEST_ENV: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    struct SingleInstanceTestEnv {
        path: PathBuf,
        previous_path: Option<std::ffi::OsString>,
        _guard: MutexGuard<'static, ()>,
    }

    impl SingleInstanceTestEnv {
        fn new(name: &str) -> Self {
            let guard = SINGLE_INSTANCE_TEST_ENV
                .lock()
                .expect("single-instance test env should lock");
            let path = temp_path(name);
            let previous_path = std::env::var_os(SINGLE_INSTANCE_LOCK_PATH_ENV);
            std::env::set_var(SINGLE_INSTANCE_LOCK_PATH_ENV, &path);
            *SINGLE_INSTANCE_LOCK
                .lock()
                .expect("single-instance state should lock") = None;
            Self {
                path,
                previous_path,
                _guard: guard,
            }
        }

        fn path(&self) -> &PathBuf {
            &self.path
        }
    }

    impl Drop for SingleInstanceTestEnv {
        fn drop(&mut self) {
            *SINGLE_INSTANCE_LOCK
                .lock()
                .expect("single-instance state should lock") = None;
            match &self.previous_path {
                Some(value) => std::env::set_var(SINGLE_INSTANCE_LOCK_PATH_ENV, value),
                None => std::env::remove_var(SINGLE_INSTANCE_LOCK_PATH_ENV),
            }
        }
    }

    #[test]
    fn app_single_instance_lock_acquires_process_lock() {
        let _env = SingleInstanceTestEnv::new("decode-before-supported");
        let result = request_single_instance_lock(None).expect("single instance lock");
        let payload = result.expect("single instance payload");

        assert_eq!(
            payload,
            json!({
                "acquired": true
            })
        );
    }

    #[test]
    fn app_single_instance_lock_accepts_null_as_wire_void() {
        let _env = SingleInstanceTestEnv::new("null-wire-void");
        let result = request_single_instance_lock(Some(Value::Null)).expect("single instance lock");
        let payload = result.expect("single instance payload");

        assert_eq!(
            payload,
            json!({
                "acquired": true
            })
        );
    }

    #[test]
    fn app_single_instance_lock_is_idempotent_for_primary_process() {
        let _env = SingleInstanceTestEnv::new("idempotent-primary");
        request_single_instance_lock(None).expect("first single instance lock");
        let result = request_single_instance_lock(None).expect("second single instance lock");

        assert_eq!(
            result.expect("single instance payload"),
            json!({
                "acquired": true
            })
        );
    }

    #[test]
    fn app_single_instance_lock_refreshes_handoff_for_primary_runtime() {
        let env = SingleInstanceTestEnv::new("handoff-refresh");
        request_single_instance_lock(None).expect("first single instance lock");
        assert!(
            read_test_lock_file(env.path()).handoff.is_none(),
            "plain lock acquisition should not advertise a handoff endpoint"
        );
        let (sender, receiver) = mpsc::channel();
        let result = request_single_instance_lock_with_event_sender(None, Some(sender))
            .expect("idempotent primary call should refresh handoff");
        assert_eq!(
            result.expect("single instance payload"),
            json!({
                "acquired": true
            })
        );
        let endpoint = read_test_lock_file(env.path())
            .handoff
            .expect("refreshed lock file should advertise a handoff endpoint");
        let event = AppSecondInstanceEventPayload::new(
            AppActivationReasonPayload::Launch,
            vec!["secondary".to_string()],
            "/repo",
            "trace-refreshed-second-instance",
        );

        send_second_instance_handoff(
            &endpoint,
            event,
            host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
        )
        .expect("refreshed handoff should reach primary listener");

        let HostProtocolEnvelope::Event { trace_id, .. } =
            receiver.recv().expect("primary should receive event")
        else {
            panic!("expected app second-instance event");
        };
        assert_eq!(trace_id, "trace-refreshed-second-instance");
    }

    #[test]
    fn app_single_instance_handoff_emits_second_instance_event() {
        let env = SingleInstanceTestEnv::new("handoff-event");
        let (sender, receiver) = mpsc::channel();
        request_single_instance_lock_with_event_sender(None, Some(sender))
            .expect("single-instance lock should start handoff server");
        let lock_file = read_test_lock_file(env.path());
        let endpoint: SingleInstanceHandoffEndpoint =
            lock_file.handoff.expect("handoff endpoint should exist");
        let event = AppSecondInstanceEventPayload::new(
            AppActivationReasonPayload::Launch,
            vec!["secondary".to_string()],
            "/repo",
            "trace-second-instance",
        );

        send_second_instance_handoff(
            &endpoint,
            event,
            host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
        )
        .expect("handoff should reach primary listener");

        let HostProtocolEnvelope::Event {
            method,
            trace_id,
            window_id,
            payload,
            ..
        } = receiver.recv().expect("primary should receive event")
        else {
            panic!("expected app second-instance event");
        };
        assert_eq!(method, host_protocol::APP_SECOND_INSTANCE_EVENT);
        assert_eq!(trace_id, "trace-second-instance");
        assert_eq!(window_id, None);
        assert_eq!(
            payload.expect("second-instance event should include payload"),
            json!({
                "activationReason": "launch",
                "argv": ["secondary"],
                "cwd": "/repo",
                "traceId": "trace-second-instance"
            })
        );
    }

    #[test]
    fn app_void_requests_reject_non_null_present_payloads() {
        assert_eq!(
            request_single_instance_lock(Some(json!({}))).expect_err("object payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
            )
        );
    }

    #[test]
    fn app_restart_routes_valid_payloads_to_window_handler() {
        let window = FakeWindowHandler::default();
        let result = restart(&window, Some(json!({ "args": ["--restarted", "safe"] })))
            .expect("restart should route");

        assert_eq!(result, None);
        assert_eq!(
            window.restarts(),
            vec![vec!["--restarted".to_string(), "safe".to_string()]]
        );
    }

    #[test]
    fn app_restart_accepts_omitted_args() {
        let window = FakeWindowHandler::default();
        let result = restart(&window, Some(json!({}))).expect("restart should route");

        assert_eq!(result, None);
        assert_eq!(window.restarts(), vec![Vec::<String>::new()]);
    }

    #[test]
    fn app_payload_requests_reject_malformed_inputs_before_restart() {
        let window = FakeWindowHandler::default();
        assert_eq!(
            restart(&window, Some(json!({ "args": null }))).expect_err("args null"),
            HostProtocolError::invalid_argument(
                "args",
                "must be omitted instead of null",
                host_protocol::APP_RESTART_METHOD,
            )
        );
        assert_eq!(
            restart(&window, Some(json!({ "args": ["bad\0arg"] })))
                .expect_err("args")
                .tag(),
            "InvalidArgument"
        );
        assert!(window.restarts().is_empty());
    }

    #[test]
    fn app_void_requests_reject_malformed_inputs_before_lock() {
        assert_eq!(
            request_single_instance_lock(Some(json!({}))).expect_err("object payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
            )
        );
    }

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "effect-desktop-single-instance-test-{name}-{}.lock",
            std::process::id()
        ))
    }

    fn read_test_lock_file(path: &PathBuf) -> super::SingleInstanceLockFile {
        let mut file = OpenOptions::new()
            .read(true)
            .open(path)
            .expect("lock file should exist");
        read_single_instance_lock_file(
            &mut file,
            host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
        )
        .expect("lock metadata should decode")
    }
}

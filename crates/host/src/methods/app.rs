#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::HostProtocolError;
use host_protocol::{AppQuitPayload, AppRestartPayload, AppSingleInstancePayload};
use serde::de::DeserializeOwned;
use serde_json::{to_value, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tracing::info;

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

pub(crate) fn restart(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(payload.as_ref(), "args", host_protocol::APP_RESTART_METHOD)?;
    let input = decode_payload::<AppRestartPayload>(payload, host_protocol::APP_RESTART_METHOD)?;
    validate_args(input.args(), host_protocol::APP_RESTART_METHOD)?;
    Err(unsupported(host_protocol::APP_RESTART_METHOD))
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
    reject_unexpected_payload(
        payload,
        host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
    )?;
    acquire_single_instance_lock(host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD)
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

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::APP_UNSUPPORTED_REASON, operation)
}

struct SingleInstanceLock {
    file: File,
}

impl Drop for SingleInstanceLock {
    fn drop(&mut self) {
        unlock_single_instance_file(&self.file);
    }
}

fn acquire_single_instance_lock(
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    let mut current = SINGLE_INSTANCE_LOCK.lock().map_err(|_| {
        HostProtocolError::internal("single-instance lock state is poisoned", operation)
    })?;
    if current.is_some() {
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

    if !try_lock_single_instance_file(&file, operation)? {
        let primary_pid = read_single_instance_primary_pid(&mut file, operation)?;
        return encode_single_instance(AppSingleInstancePayload::owned_by(primary_pid), operation);
    }

    let primary_pid = u64::from(std::process::id());
    write_single_instance_primary_pid(&mut file, primary_pid, operation)?;
    *current = Some(SingleInstanceLock { file });
    encode_single_instance(AppSingleInstancePayload::acquired(), operation)
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

fn write_single_instance_primary_pid(
    file: &mut File,
    primary_pid: u64,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
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
    writeln!(file, "{primary_pid}").map_err(|error| {
        HostProtocolError::internal(
            format!("failed to write single-instance primary pid: {error}"),
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

fn read_single_instance_primary_pid(
    file: &mut File,
    operation: &'static str,
) -> Result<u64, HostProtocolError> {
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
    buffer.trim().parse::<u64>().map_err(|error| {
        HostProtocolError::internal(
            format!("single-instance primary pid is invalid: {error}"),
            operation,
        )
    })
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
        request_single_instance_lock, restart, SINGLE_INSTANCE_LOCK, SINGLE_INSTANCE_LOCK_PATH_ENV,
    };
    use host_protocol::HostProtocolError;
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::{LazyLock, Mutex, MutexGuard};

    static SINGLE_INSTANCE_TEST_ENV: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    struct SingleInstanceTestEnv {
        previous_path: Option<std::ffi::OsString>,
        _guard: MutexGuard<'static, ()>,
    }

    impl SingleInstanceTestEnv {
        fn new(name: &str) -> Self {
            let guard = SINGLE_INSTANCE_TEST_ENV
                .lock()
                .expect("single-instance test env should lock");
            let previous_path = std::env::var_os(SINGLE_INSTANCE_LOCK_PATH_ENV);
            std::env::set_var(SINGLE_INSTANCE_LOCK_PATH_ENV, temp_path(name));
            *SINGLE_INSTANCE_LOCK
                .lock()
                .expect("single-instance state should lock") = None;
            Self {
                previous_path,
                _guard: guard,
            }
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
    fn app_payload_requests_decode_before_unsupported() {
        assert_eq!(
            restart(Some(json!({ "args": ["--restarted"] }))).expect_err("restart"),
            HostProtocolError::unsupported(
                host_protocol::APP_UNSUPPORTED_REASON,
                host_protocol::APP_RESTART_METHOD,
            )
        );
    }

    #[test]
    fn app_payload_requests_reject_malformed_inputs_before_unsupported() {
        assert_eq!(
            restart(Some(json!({ "args": null }))).expect_err("args null"),
            HostProtocolError::invalid_argument(
                "args",
                "must be omitted instead of null",
                host_protocol::APP_RESTART_METHOD,
            )
        );
        assert_eq!(
            restart(Some(json!({ "args": ["bad\0arg"] })))
                .expect_err("args")
                .tag(),
            "InvalidArgument"
        );
    }

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "effect-desktop-single-instance-test-{name}-{}.lock",
            std::process::id()
        ))
    }
}

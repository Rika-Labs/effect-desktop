#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use host_protocol::{
    HostProtocolError, PtyExitStatusPayload, PtyIdPayload, PtyKillPayload, PtyOpenPayload,
    PtyOpenResultPayload, PtyReadPayload, PtyReadResultPayload, PtyResizePayload, PtySignalPayload,
    PtyWritePayload,
};
use native_pty::{NativePty, PtyCommand, PtyError, PtyExitStatus, PtySize};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::Read,
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc, LazyLock, Mutex,
    },
    thread,
    time::Duration,
};
use uuid::Uuid;

const OUTPUT_CHUNK_BYTES: usize = 16 * 1024;
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(10);
const CLOSE_GRACE: Duration = Duration::from_millis(250);

type PtyRecordMap = HashMap<String, Arc<PtyRecord>>;

struct PtyRecord {
    pty: Arc<Mutex<NativePty>>,
    output: Mutex<OutputState>,
    exit: Mutex<ExitState>,
}

struct OutputState {
    receiver: Receiver<PtyOutputEvent>,
    pending: VecDeque<u8>,
    done: bool,
}

struct ExitState {
    receiver: Receiver<Result<PtyExitStatus, PtyError>>,
    cached: Option<Result<PtyExitStatus, PtyError>>,
}

enum PtyOutputEvent {
    Data(Vec<u8>),
    Done,
    Error(String),
}

struct PtyReadResult {
    bytes: Vec<u8>,
    done: bool,
}

static PTY_RECORDS: LazyLock<Mutex<PtyRecordMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));
#[cfg(test)]
static PTY_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub(crate) fn open(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyOpenPayload>(payload, host_protocol::PTY_OPEN_METHOD)?;
    let mut pty = native_pty::open(
        PtySize {
            rows: input.rows(),
            cols: input.cols(),
        },
        pty_command(&input),
    )
    .map_err(map_native_error)?;
    let pid = pty.process_id();
    let reader = pty.take_reader().map_err(map_native_error)?;
    let pty = Arc::new(Mutex::new(pty));
    let (output_tx, output_rx) = mpsc::channel();
    let (exit_tx, exit_rx) = mpsc::channel();

    spawn_output_reader(reader, output_tx);
    spawn_exit_watcher(Arc::clone(&pty), exit_tx);

    let record = Arc::new(PtyRecord {
        pty,
        output: Mutex::new(OutputState {
            receiver: output_rx,
            pending: VecDeque::new(),
            done: false,
        }),
        exit: Mutex::new(ExitState {
            receiver: exit_rx,
            cached: None,
        }),
    });
    let pty_id = insert_record(record, host_protocol::PTY_OPEN_METHOD)?;

    encode_payload(
        PtyOpenResultPayload::new(pty_id, pid),
        host_protocol::PTY_OPEN_METHOD,
    )
}

pub(crate) fn read(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyReadPayload>(payload, host_protocol::PTY_READ_METHOD)?;
    if input.max_bytes() == 0 {
        return Err(HostProtocolError::invalid_argument(
            "maxBytes",
            "must be greater than zero",
            host_protocol::PTY_READ_METHOD,
        ));
    }

    let record = lookup_record(input.pty_id(), host_protocol::PTY_READ_METHOD)?;
    let result = record
        .output
        .lock()
        .map_err(|_| {
            HostProtocolError::internal("PTY output lock poisoned", host_protocol::PTY_READ_METHOD)
        })?
        .read(input.max_bytes(), host_protocol::PTY_READ_METHOD)?;
    encode_payload(
        PtyReadResultPayload::new(BASE64.encode(result.bytes), result.done),
        host_protocol::PTY_READ_METHOD,
    )
}

pub(crate) fn write(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyWritePayload>(payload, host_protocol::PTY_WRITE_METHOD)?;
    let bytes = decode_base64(input.bytes_base64(), host_protocol::PTY_WRITE_METHOD)?;
    let record = lookup_record(input.pty_id(), host_protocol::PTY_WRITE_METHOD)?;
    let mut pty = record.pty.lock().map_err(|_| {
        HostProtocolError::internal("PTY state lock poisoned", host_protocol::PTY_WRITE_METHOD)
    })?;
    pty.write(&bytes).map(|_| None).map_err(map_native_error)
}

pub(crate) fn resize(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyResizePayload>(payload, host_protocol::PTY_RESIZE_METHOD)?;
    let record = lookup_record(input.pty_id(), host_protocol::PTY_RESIZE_METHOD)?;
    let pty = record.pty.lock().map_err(|_| {
        HostProtocolError::internal("PTY state lock poisoned", host_protocol::PTY_RESIZE_METHOD)
    })?;
    pty.resize(PtySize {
        rows: input.rows(),
        cols: input.cols(),
    })
    .map(|()| None)
    .map_err(map_native_error)
}

pub(crate) fn kill(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyKillPayload>(payload, host_protocol::PTY_KILL_METHOD)?;
    let record = lookup_record(input.pty_id(), host_protocol::PTY_KILL_METHOD)?;
    let mut pty = record.pty.lock().map_err(|_| {
        HostProtocolError::internal("PTY state lock poisoned", host_protocol::PTY_KILL_METHOD)
    })?;
    signal_pty(&mut pty, input.signal(), host_protocol::PTY_KILL_METHOD).map(|()| None)
}

pub(crate) fn terminate_tree(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyIdPayload>(payload, host_protocol::PTY_TERMINATE_TREE_METHOD)?;
    let record = lookup_record(input.pty_id(), host_protocol::PTY_TERMINATE_TREE_METHOD)?;
    let mut pty = record.pty.lock().map_err(|_| {
        HostProtocolError::internal(
            "PTY state lock poisoned",
            host_protocol::PTY_TERMINATE_TREE_METHOD,
        )
    })?;
    pty.terminate_tree()
        .map(|()| None)
        .map_err(map_native_error)
}

pub(crate) fn force_kill_tree(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyIdPayload>(payload, host_protocol::PTY_FORCE_KILL_TREE_METHOD)?;
    let record = lookup_record(input.pty_id(), host_protocol::PTY_FORCE_KILL_TREE_METHOD)?;
    let mut pty = record.pty.lock().map_err(|_| {
        HostProtocolError::internal(
            "PTY state lock poisoned",
            host_protocol::PTY_FORCE_KILL_TREE_METHOD,
        )
    })?;
    pty.force_kill_tree()
        .map(|()| None)
        .map_err(map_native_error)
}

pub(crate) fn wait(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyIdPayload>(payload, host_protocol::PTY_WAIT_METHOD)?;
    let record = lookup_record(input.pty_id(), host_protocol::PTY_WAIT_METHOD)?;
    let status = record
        .exit
        .lock()
        .map_err(|_| {
            HostProtocolError::internal("PTY exit lock poisoned", host_protocol::PTY_WAIT_METHOD)
        })?
        .wait(host_protocol::PTY_WAIT_METHOD)?;

    encode_payload(
        PtyExitStatusPayload::new(status.code, status.signal),
        host_protocol::PTY_WAIT_METHOD,
    )
}

pub(crate) fn dispose(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<PtyIdPayload>(payload, host_protocol::PTY_DISPOSE_METHOD)?;
    let record = remove_record(input.pty_id(), host_protocol::PTY_DISPOSE_METHOD)?;
    close_record(record, host_protocol::PTY_DISPOSE_METHOD)?;
    Ok(None)
}

pub(crate) fn close_resource_for_cancel(
    resource_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(resource_id) = resource_id else {
        return Ok(());
    };
    if let Some(record) = remove_record_if_present(resource_id, operation)? {
        close_record(record, operation)?;
    }
    Ok(())
}

pub(crate) fn clear_runtime_resources(operation: &'static str) -> Result<(), HostProtocolError> {
    let records = drain_records(operation)?;
    let mut first_error = None;
    for record in records {
        if let Err(error) = close_record(record, operation) {
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(test)]
pub(crate) fn state_test_guard() -> std::sync::MutexGuard<'static, ()> {
    let guard = PTY_TEST_LOCK
        .lock()
        .expect("PTY test lock should not be poisoned");
    clear_runtime_resources("host.runtime.test").expect("PTY test state should clear");
    guard
}

impl OutputState {
    fn read(
        &mut self,
        max_bytes: usize,
        operation: &'static str,
    ) -> Result<PtyReadResult, HostProtocolError> {
        if !self.pending.is_empty() {
            return Ok(PtyReadResult {
                bytes: self.drain_pending(max_bytes),
                done: false,
            });
        }

        if self.done {
            return Ok(PtyReadResult {
                bytes: Vec::new(),
                done: true,
            });
        }

        match self.receiver.recv() {
            Ok(PtyOutputEvent::Data(bytes)) => {
                self.pending.extend(bytes);
                Ok(PtyReadResult {
                    bytes: self.drain_pending(max_bytes),
                    done: false,
                })
            }
            Ok(PtyOutputEvent::Done) | Err(_) => {
                self.done = true;
                Ok(PtyReadResult {
                    bytes: Vec::new(),
                    done: true,
                })
            }
            Ok(PtyOutputEvent::Error(message)) => {
                self.done = true;
                Err(HostProtocolError::internal(message, operation))
            }
        }
    }

    fn drain_pending(&mut self, max_bytes: usize) -> Vec<u8> {
        let count = self.pending.len().min(max_bytes);
        self.pending.drain(..count).collect()
    }
}

impl ExitState {
    fn wait(&mut self, operation: &'static str) -> Result<PtyExitStatus, HostProtocolError> {
        if let Some(result) = &self.cached {
            return result.clone().map_err(map_native_error);
        }

        let result = self.receiver.recv().unwrap_or_else(|_| {
            Err(PtyError::Internal {
                message: "PTY exit watcher disconnected".to_string(),
                operation,
            })
        });
        self.cached = Some(result.clone());
        result.map_err(map_native_error)
    }
}

fn pty_command(input: &PtyOpenPayload) -> PtyCommand {
    let mut command = PtyCommand::new(input.command().to_string());
    for arg in input.args() {
        command = command.arg(arg.clone());
    }
    for (key, value) in input.env() {
        command = command.env(key.clone(), value.clone());
    }
    if let Some(cwd) = input.cwd() {
        command = command.cwd(PathBuf::from(cwd));
    }
    command
}

fn spawn_output_reader(mut reader: Box<dyn Read + Send>, sender: Sender<PtyOutputEvent>) {
    thread::spawn(move || loop {
        let mut bytes = vec![0; OUTPUT_CHUNK_BYTES];
        match reader.read(&mut bytes) {
            Ok(0) => {
                let _ = sender.send(PtyOutputEvent::Done);
                break;
            }
            Ok(read) => {
                bytes.truncate(read);
                if sender.send(PtyOutputEvent::Data(bytes)).is_err() {
                    break;
                }
            }
            Err(error) => {
                if is_pty_output_eof(&error) {
                    let _ = sender.send(PtyOutputEvent::Done);
                    break;
                }
                let _ = sender.send(PtyOutputEvent::Error(error.to_string()));
                break;
            }
        }
    });
}

fn is_pty_output_eof(error: &std::io::Error) -> bool {
    if matches!(
        error.kind(),
        std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::BrokenPipe
    ) {
        return true;
    }

    #[cfg(unix)]
    {
        error.raw_os_error() == Some(libc::EIO)
    }

    #[cfg(not(unix))]
    {
        false
    }
}

fn spawn_exit_watcher(pty: Arc<Mutex<NativePty>>, sender: Sender<Result<PtyExitStatus, PtyError>>) {
    thread::spawn(move || loop {
        let result = match pty.lock() {
            Ok(mut pty) => pty.try_wait(),
            Err(_) => Err(PtyError::Internal {
                message: "PTY state lock poisoned".to_string(),
                operation: "Pty.wait",
            }),
        };

        match result {
            Ok(Some(status)) => {
                let _ = sender.send(Ok(status));
                break;
            }
            Ok(None) => thread::sleep(EXIT_POLL_INTERVAL),
            Err(error) => {
                let _ = sender.send(Err(error));
                break;
            }
        }
    });
}

fn signal_pty(
    pty: &mut NativePty,
    signal: Option<&PtySignalPayload>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(signal) = signal else {
        return pty.terminate_tree().map_err(map_native_error);
    };
    match signal_number(signal, operation)? {
        15 => pty.terminate_tree().map_err(map_native_error),
        9 => pty.force_kill_tree().map_err(map_native_error),
        signal => pty.signal_tree(signal).map_err(map_native_error),
    }
}

fn signal_number(
    signal: &PtySignalPayload,
    operation: &'static str,
) -> Result<i32, HostProtocolError> {
    match signal {
        PtySignalPayload::Number(signal) if *signal > 0 => Ok(*signal),
        PtySignalPayload::Number(_) => Err(HostProtocolError::invalid_argument(
            "signal",
            "must be greater than zero",
            operation,
        )),
        PtySignalPayload::Name(name) => match canonical_signal_name(name).as_str() {
            "HUP" => Ok(1),
            "INT" => Ok(2),
            "TERM" => Ok(15),
            "KILL" => Ok(9),
            _ => Err(HostProtocolError::invalid_argument(
                "signal",
                "must be SIGTERM, SIGKILL, SIGINT, SIGHUP, or a positive integer",
                operation,
            )),
        },
    }
}

fn canonical_signal_name(name: &str) -> String {
    let uppercase = name.trim().to_ascii_uppercase();
    uppercase
        .strip_prefix("SIG")
        .unwrap_or(&uppercase)
        .to_string()
}

fn insert_record(
    record: Arc<PtyRecord>,
    operation: &'static str,
) -> Result<String, HostProtocolError> {
    let mut records = records(operation)?;
    loop {
        let id = format!("pty-{}", Uuid::now_v7());
        if let std::collections::hash_map::Entry::Vacant(entry) = records.entry(id.clone()) {
            entry.insert(Arc::clone(&record));
            return Ok(id);
        }
    }
}

fn lookup_record(
    pty_id: &str,
    operation: &'static str,
) -> Result<Arc<PtyRecord>, HostProtocolError> {
    records(operation)?
        .get(pty_id)
        .cloned()
        .ok_or_else(|| stale_pty_handle(pty_id, operation))
}

fn remove_record(
    pty_id: &str,
    operation: &'static str,
) -> Result<Arc<PtyRecord>, HostProtocolError> {
    records(operation)?
        .remove(pty_id)
        .ok_or_else(|| stale_pty_handle(pty_id, operation))
}

fn remove_record_if_present(
    pty_id: &str,
    operation: &'static str,
) -> Result<Option<Arc<PtyRecord>>, HostProtocolError> {
    Ok(records(operation)?.remove(pty_id))
}

fn drain_records(operation: &'static str) -> Result<Vec<Arc<PtyRecord>>, HostProtocolError> {
    Ok(records(operation)?
        .drain()
        .map(|(_, record)| record)
        .collect())
}

fn close_record(record: Arc<PtyRecord>, operation: &'static str) -> Result<(), HostProtocolError> {
    record
        .pty
        .lock()
        .map_err(|_| HostProtocolError::internal("PTY state lock poisoned", operation))?
        .close_tree(CLOSE_GRACE)
        .map(|_| ())
        .map_err(map_native_error)
}

fn records(
    operation: &'static str,
) -> Result<std::sync::MutexGuard<'static, PtyRecordMap>, HostProtocolError> {
    PTY_RECORDS
        .lock()
        .map_err(|_| HostProtocolError::internal("PTY registry lock poisoned", operation))
}

fn stale_pty_handle(pty_id: &str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::StaleHandle {
        kind: "pty".to_string(),
        id: pty_id.to_string(),
        expected_generation: 0,
        actual_generation: 1,
        message: format!("stale PTY handle: {pty_id}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("StaleHandle").expect("known tag"),
        remediation: None,
        docs_url: None,
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

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload)
        .map(Some)
        .map_err(|error| HostProtocolError::invalid_output(operation, error.to_string()))
}

fn decode_base64(value: &str, operation: &'static str) -> Result<Vec<u8>, HostProtocolError> {
    BASE64
        .decode(value)
        .map_err(|error| binary_decode_error(error.to_string(), operation))
}

fn binary_decode_error(reason: String, operation: &'static str) -> HostProtocolError {
    HostProtocolError::BinaryDecodeError {
        message: format!("failed to decode PTY bytes: {reason}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("BinaryDecodeError")
            .expect("known tag"),
        remediation: None,
        docs_url: None,
        reason,
    }
}

fn map_native_error(error: PtyError) -> HostProtocolError {
    match error {
        PtyError::InvalidArgument {
            field,
            reason,
            operation,
        } => HostProtocolError::invalid_argument(field, reason, operation),
        PtyError::FileNotFound { path, operation } => HostProtocolError::FileNotFound {
            message: format!("PTY path not found: {path}"),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("FileNotFound").expect("known tag"),
            remediation: None,
            docs_url: None,
            path,
        },
        PtyError::PermissionDenied {
            resource,
            operation,
        } => HostProtocolError::PermissionDenied {
            capability: "pty.spawn".to_string(),
            resource: Some(resource.clone()),
            message: format!("PTY permission denied: {resource}"),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("PermissionDenied")
                .expect("known tag"),
            remediation: None,
            docs_url: None,
        },
        PtyError::ResourceBusy {
            resource,
            operation,
        } => HostProtocolError::ResourceBusy {
            message: format!("PTY resource busy: {resource}"),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("ResourceBusy").expect("known tag"),
            remediation: None,
            docs_url: None,
            resource,
        },
        PtyError::InvalidState {
            current,
            attempted,
            operation,
        } => HostProtocolError::InvalidState {
            message: format!("invalid PTY state {current} for {attempted}"),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
            remediation: None,
            docs_url: None,
            current: current.to_string(),
            attempted: attempted.to_string(),
        },
        PtyError::PanicInNativeCode { operation } => HostProtocolError::PanicInNativeCode {
            message: format!("native PTY panic during {operation}"),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("PanicInNativeCode")
                .expect("known tag"),
            remediation: None,
            docs_url: None,
            backtrace: None,
            location: None,
        },
        PtyError::Internal { message, operation } => {
            HostProtocolError::internal(message, operation)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use host_protocol::{PtyIdPayload, PtyReadPayload};
    #[cfg(unix)]
    use serde::de::DeserializeOwned;

    #[cfg(unix)]
    #[test]
    fn opens_reads_waits_and_disposes_native_pty() {
        let _guard = state_test_guard();
        let opened = open(Some(
            to_value(PtyOpenPayload::new(
                "/bin/sh",
                vec!["-lc".to_string(), "printf native-pty-ok".to_string()],
                24,
                80,
                None,
                Default::default(),
            ))
            .expect("open payload should encode"),
        ))
        .expect("PTY.open should succeed");
        let opened: PtyOpenResultPayload = decode_test_payload(opened);

        let output = read_until_done(opened.pty_id());
        let status = wait(Some(
            to_value(PtyIdPayload::new(opened.pty_id())).expect("wait payload should encode"),
        ))
        .expect("PTY.wait should succeed");
        let status: PtyExitStatusPayload = decode_test_payload(status);

        assert!(output.contains("native-pty-ok"), "{output:?}");
        assert_eq!(status.code(), 0);
        assert_eq!(status.signal(), None);
        dispose(Some(
            to_value(PtyIdPayload::new(opened.pty_id())).expect("dispose payload should encode"),
        ))
        .expect("PTY.dispose should succeed");
    }

    #[cfg(unix)]
    #[test]
    fn read_respects_requested_max_bytes() {
        let _guard = state_test_guard();
        let opened = open(Some(
            to_value(PtyOpenPayload::new(
                "/bin/sh",
                vec!["-lc".to_string(), "printf abc".to_string()],
                24,
                80,
                None,
                Default::default(),
            ))
            .expect("open payload should encode"),
        ))
        .expect("PTY.open should succeed");
        let opened: PtyOpenResultPayload = decode_test_payload(opened);
        let first = read(Some(
            to_value(PtyReadPayload::new(opened.pty_id(), 1)).expect("read payload should encode"),
        ))
        .expect("PTY.read should succeed");
        let first: PtyReadResultPayload = decode_test_payload(first);
        let first_bytes = BASE64
            .decode(first.bytes_base64())
            .expect("read result should be base64");

        assert_eq!(first_bytes.len(), 1);
        let _ = wait(Some(
            to_value(PtyIdPayload::new(opened.pty_id())).expect("wait payload should encode"),
        ));
        let _ = dispose(Some(
            to_value(PtyIdPayload::new(opened.pty_id())).expect("dispose payload should encode"),
        ));
    }

    #[test]
    fn invalid_open_payload_returns_invalid_argument() {
        let _guard = state_test_guard();
        let error = open(Some(serde_json::json!({ "command": "" })))
            .expect_err("invalid payload should fail");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[cfg(unix)]
    fn read_until_done(pty_id: &str) -> String {
        let mut output = Vec::new();
        loop {
            let result = read(Some(
                to_value(PtyReadPayload::new(pty_id, 8)).expect("read payload should encode"),
            ))
            .expect("PTY.read should succeed");
            let result: PtyReadResultPayload = decode_test_payload(result);
            output.extend(
                BASE64
                    .decode(result.bytes_base64())
                    .expect("read result should be base64"),
            );
            if result.done() {
                break;
            }
        }
        String::from_utf8_lossy(&output).into_owned()
    }

    #[cfg(unix)]
    fn decode_test_payload<T: DeserializeOwned>(payload: Option<Value>) -> T {
        serde_json::from_value(payload.expect("response should include payload"))
            .expect("payload should decode")
    }
}

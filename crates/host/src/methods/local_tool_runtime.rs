#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::runtime::platform;
use host_protocol::{
    HostProtocolEnvelope, HostProtocolError, LocalToolRuntimeActorPayload,
    LocalToolRuntimeCommandPayload, LocalToolRuntimeEventPayload, LocalToolRuntimeEventPhase,
    LocalToolRuntimeHealthPayload, LocalToolRuntimeHealthResultPayload,
    LocalToolRuntimeHealthStatus, LocalToolRuntimeManifestPayload, LocalToolRuntimeRegisterPayload,
    LocalToolRuntimeRegisterResultPayload, LocalToolRuntimeRunPayload,
    LocalToolRuntimeRunResultPayload, LocalToolRuntimeRunStatus, LocalToolRuntimeStdioMode,
    LocalToolRuntimeStopPayload, LocalToolRuntimeStopResultPayload,
    LocalToolRuntimeSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const OUTPUT_DRAIN_GRACE: Duration = Duration::from_millis(250);
const TERMINATION_GRACE: Duration = Duration::from_millis(50);
const FORCE_TERMINATION_WAIT: Duration = Duration::from_secs(2);
const UNBOUNDED_OS_BUDGET: u64 = 9_007_199_254_740_991;

pub(crate) type EventPayload = (&'static str, Value);
pub(crate) type EventfulResponse = Result<(Option<Value>, Vec<EventPayload>), HostProtocolError>;
type RuntimeSessions = HashMap<String, LocalToolRuntimeSession>;
type RuntimeSessionGuard = std::sync::MutexGuard<'static, RuntimeSessions>;
type ActiveRunKey = (String, String);
type ActiveRuns = HashMap<ActiveRunKey, ActiveRun>;
type ActiveRunGuard = std::sync::MutexGuard<'static, ActiveRuns>;
type ActiveRunRequests = HashMap<String, ActiveRun>;
type ActiveRunRequestGuard = std::sync::MutexGuard<'static, ActiveRunRequests>;
type PendingRunRequests = HashSet<String>;
type PendingRunRequestGuard = std::sync::MutexGuard<'static, PendingRunRequests>;
type CanceledRunRequests = HashSet<String>;
type CanceledRunRequestGuard = std::sync::MutexGuard<'static, CanceledRunRequests>;

#[derive(Clone)]
struct LocalToolRuntimeSession {
    tool_id: String,
    manifest: LocalToolRuntimeManifestPayload,
    cwd_roots: Vec<PathBuf>,
}

struct ProcessOutput {
    text: String,
    exceeded: bool,
    limit: u64,
    observed_bytes: u64,
}

struct CapturedStream {
    receiver: Receiver<Result<ProcessOutput, io::Error>>,
}

struct CapturedProcess {
    status: Option<ExitStatus>,
    timed_out: bool,
    stopped: bool,
    stdout: String,
    stderr: String,
}

#[cfg(not(windows))]
struct LocalToolChild {
    child: std::process::Child,
}

#[cfg(not(windows))]
impl LocalToolChild {
    fn new(child: std::process::Child) -> Self {
        Self { child }
    }

    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    fn kill(&mut self) -> io::Result<()> {
        self.child.kill()
    }
}

#[cfg(windows)]
struct LocalToolChild {
    process: windows_sys::Win32::Foundation::HANDLE,
    thread: windows_sys::Win32::Foundation::HANDLE,
    job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
type WindowsHandle = windows_sys::Win32::Foundation::HANDLE;

#[cfg(windows)]
unsafe impl Send for LocalToolChild {}

#[cfg(windows)]
impl LocalToolChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        use std::os::windows::process::ExitStatusExt;
        use windows_sys::Win32::{
            Foundation::{STILL_ACTIVE, WAIT_TIMEOUT},
            System::Threading::{GetExitCodeProcess, WaitForSingleObject},
        };

        let waited = unsafe { WaitForSingleObject(self.process, 0) };
        if waited == WAIT_TIMEOUT {
            return Ok(None);
        }

        let mut exit_code = 0_u32;
        let code_read = unsafe { GetExitCodeProcess(self.process, &mut exit_code) };
        if code_read == 0 {
            return Err(io::Error::last_os_error());
        }
        if exit_code == STILL_ACTIVE as u32 {
            return Ok(None);
        }
        Ok(Some(ExitStatus::from_raw(exit_code)))
    }

    fn kill(&mut self) -> io::Result<()> {
        use windows_sys::Win32::System::Threading::TerminateProcess;

        let terminated = unsafe { TerminateProcess(self.process, 1) };
        if terminated == 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::InvalidInput {
                Ok(())
            } else {
                Err(error)
            }
        } else {
            Ok(())
        }
    }

    fn terminate_tree(&mut self) -> io::Result<()> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        let terminated = unsafe { TerminateJobObject(self.job, 15) };
        if terminated == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn force_terminate_tree(&mut self) -> io::Result<()> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        let terminated = unsafe { TerminateJobObject(self.job, 9) };
        if terminated == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn cleanup_process_tree_after_exit(&self) -> io::Result<()> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        let terminated = unsafe { TerminateJobObject(self.job, 0) };
        if terminated == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
impl Drop for LocalToolChild {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;

        unsafe {
            CloseHandle(self.job);
            CloseHandle(self.thread);
            CloseHandle(self.process);
        }
    }
}

#[cfg(not(windows))]
enum LocalToolChildGuard {
    Platform(platform::ChildGuard),
}

#[cfg(windows)]
struct LocalToolChildGuard;

struct SpawnedLocalToolChild {
    child: LocalToolChild,
    guard: LocalToolChildGuard,
    stdout: Option<Box<dyn Read + Send>>,
    stderr: Option<Box<dyn Read + Send>>,
}

struct LocalToolSpawn<'a> {
    executable: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    env: Vec<(String, String)>,
    stdio: &'a host_protocol::LocalToolRuntimeStdioPolicyPayload,
}

#[derive(Clone)]
struct ActiveRun {
    state: Arc<Mutex<ActiveRunState>>,
    kill_process_tree: bool,
}

enum ActiveRunState {
    Starting {
        stopped: bool,
    },
    Running {
        child: Arc<Mutex<LocalToolChild>>,
        stopped: bool,
    },
}

impl ActiveRun {
    fn new(kill_process_tree: bool) -> Self {
        Self {
            state: Arc::new(Mutex::new(ActiveRunState::Starting { stopped: false })),
            kill_process_tree,
        }
    }

    fn stopped(&self, operation: &'static str) -> Result<bool, HostProtocolError> {
        let state = self.state.lock().map_err(|_| {
            HostProtocolError::internal("local tool active run state lock poisoned", operation)
        })?;
        Ok(match &*state {
            ActiveRunState::Starting { stopped } | ActiveRunState::Running { stopped, .. } => {
                *stopped
            }
        })
    }

    fn mark_stopped(
        &self,
        operation: &'static str,
    ) -> Result<Option<Arc<Mutex<LocalToolChild>>>, HostProtocolError> {
        let mut state = self.state.lock().map_err(|_| {
            HostProtocolError::internal("local tool active run state lock poisoned", operation)
        })?;
        match &mut *state {
            ActiveRunState::Starting { stopped } => {
                *stopped = true;
                Ok(None)
            }
            ActiveRunState::Running { child, stopped } => {
                *stopped = true;
                Ok(Some(child.clone()))
            }
        }
    }
}

struct StartedEvent<'a> {
    sink: &'a RuntimeEventSink,
    timestamp: u64,
    payload: Value,
}

struct RunCommandRequest<'a> {
    request_id: Option<&'a str>,
    runtime_id: &'a str,
    args: &'a [String],
    run_id: String,
    timeout_override: Option<u64>,
    started_event: Option<StartedEvent<'a>>,
}

pub(crate) struct RuntimeEventSink {
    sender: Sender<HostProtocolEnvelope>,
    trace_id: String,
    window_id: Option<String>,
}

impl RuntimeEventSink {
    pub(crate) fn new(
        sender: Sender<HostProtocolEnvelope>,
        trace_id: String,
        window_id: Option<String>,
    ) -> Self {
        Self {
            sender,
            trace_id,
            window_id,
        }
    }

    fn send(
        &self,
        method: &'static str,
        timestamp: u64,
        payload: Value,
        operation: &'static str,
    ) -> Result<(), HostProtocolError> {
        self.sender
            .send(HostProtocolEnvelope::Event {
                method: method.to_string(),
                timestamp,
                trace_id: self.trace_id.clone(),
                window_id: self.window_id.clone(),
                payload: Some(payload),
            })
            .map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to emit local tool runtime event: {error}"),
                    operation,
                )
            })
    }
}

static LOCAL_TOOL_RUNTIMES: OnceLock<Mutex<RuntimeSessions>> = OnceLock::new();
static ACTIVE_LOCAL_TOOL_RUNS: OnceLock<Mutex<ActiveRuns>> = OnceLock::new();
static PENDING_LOCAL_TOOL_RUN_REQUESTS: OnceLock<Mutex<PendingRunRequests>> = OnceLock::new();
static ACTIVE_LOCAL_TOOL_RUN_REQUESTS: OnceLock<Mutex<ActiveRunRequests>> = OnceLock::new();
static CANCELED_LOCAL_TOOL_RUN_REQUESTS: OnceLock<Mutex<CanceledRunRequests>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn register(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    register_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn register_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<LocalToolRuntimeRegisterPayload>(
        payload,
        host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
    )?;
    let operation = host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD;
    validate_register(&input, operation)?;
    ensure_supported_platform(operation)?;
    let cwd_roots = canonical_cwd_roots(input.manifest(), operation)?;
    validate_command_cwds(input.manifest(), &cwd_roots, operation)?;
    validate_command_executables(input.manifest(), operation)?;
    let runtime_id = input
        .runtime_id()
        .map(ToString::to_string)
        .unwrap_or_else(generate_runtime_id);
    let tool_id = input.manifest().tool_id().to_string();
    insert_session(
        runtime_id.clone(),
        LocalToolRuntimeSession {
            tool_id: tool_id.clone(),
            manifest: input.manifest().clone(),
            cwd_roots,
        },
        operation,
    )?;
    let result = LocalToolRuntimeRegisterResultPayload::registered(
        runtime_id.clone(),
        tool_id.clone(),
        input.manifest().clone(),
    );

    Ok((
        encode_payload(result, operation)?,
        vec![local_tool_runtime_event(
            LocalToolRuntimeEventPayload::new(
                timestamp,
                runtime_id,
                LocalToolRuntimeEventPhase::Registered,
            )
            .with_tool(tool_id),
            operation,
        )?],
    ))
}

#[cfg(test)]
pub(crate) fn run(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    run_with_event(payload, 0).map(|(payload, _)| payload)
}

#[cfg(test)]
pub(crate) fn run_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    run_with_event_sink(payload, timestamp, None)
}

#[cfg(test)]
pub(crate) fn run_with_event_sink(
    payload: Option<Value>,
    timestamp: u64,
    event_sink: Option<RuntimeEventSink>,
) -> EventfulResponse {
    run_with_event_sink_for_request(payload, timestamp, None, event_sink)
}

pub(crate) fn run_with_event_sink_for_request(
    payload: Option<Value>,
    timestamp: u64,
    request_id: Option<&str>,
    event_sink: Option<RuntimeEventSink>,
) -> EventfulResponse {
    let input = decode_payload::<LocalToolRuntimeRunPayload>(
        payload,
        host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
    )?;
    let operation = host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD;
    validate_run(&input, operation)?;
    ensure_supported_platform(operation)?;
    let session = get_session(input.runtime_id(), operation)?;
    let command = command_by_id(&session.manifest, input.command_id(), operation)?;
    let run_id = input
        .run_id()
        .map(ToString::to_string)
        .unwrap_or_else(generate_run_id);
    let started_event = local_tool_runtime_event(
        LocalToolRuntimeEventPayload::new(
            timestamp,
            input.runtime_id(),
            LocalToolRuntimeEventPhase::RunStarted,
        )
        .with_run_ref(
            session.tool_id.clone(),
            input.command_id().to_string(),
            run_id.clone(),
        ),
        operation,
    )?;
    let run = run_command(
        command,
        &session,
        RunCommandRequest {
            request_id,
            runtime_id: input.runtime_id(),
            args: input.args(),
            run_id: run_id.clone(),
            timeout_override: command.timeout_millis(),
            started_event: event_sink.as_ref().map(|sink| StartedEvent {
                sink,
                timestamp,
                payload: started_event.1.clone(),
            }),
        },
        operation,
    )?;
    let status = run_status(&run);
    let exit_code = run
        .status
        .and_then(|status| status.code())
        .and_then(|code| u32::try_from(code).ok());
    let result = LocalToolRuntimeRunResultPayload::new(
        input.runtime_id(),
        input.command_id(),
        run_id.clone(),
        status,
        exit_code,
        run.stdout,
        run.stderr,
    );

    Ok((
        encode_payload(result, operation)?,
        if run.stopped {
            Vec::new()
        } else if event_sink.is_some() {
            vec![local_tool_runtime_event(
                LocalToolRuntimeEventPayload::new(
                    timestamp,
                    input.runtime_id(),
                    LocalToolRuntimeEventPhase::RunCompleted,
                )
                .with_run(
                    session.tool_id,
                    input.command_id().to_string(),
                    run_id,
                    status,
                ),
                operation,
            )?]
        } else {
            vec![
                started_event,
                local_tool_runtime_event(
                    LocalToolRuntimeEventPayload::new(
                        timestamp,
                        input.runtime_id(),
                        LocalToolRuntimeEventPhase::RunCompleted,
                    )
                    .with_run(
                        session.tool_id,
                        input.command_id().to_string(),
                        run_id,
                        status,
                    ),
                    operation,
                )?,
            ]
        },
    ))
}

#[cfg(test)]
pub(crate) fn stop(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    stop_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn stop_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<LocalToolRuntimeStopPayload>(
        payload,
        host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD,
    )?;
    let operation = host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD;
    validate_stop(&input, operation)?;
    ensure_supported_platform(operation)?;
    let session = get_session(input.runtime_id(), operation)?;
    remove_session(input.runtime_id(), operation)?;
    terminate_active_runs(input.runtime_id(), operation)?;
    Ok((
        encode_payload(
            LocalToolRuntimeStopResultPayload::stopped(input.runtime_id()),
            operation,
        )?,
        vec![local_tool_runtime_event(
            LocalToolRuntimeEventPayload::new(
                timestamp,
                input.runtime_id(),
                LocalToolRuntimeEventPhase::Stopped,
            )
            .with_tool(session.tool_id),
            operation,
        )?],
    ))
}

#[cfg(test)]
pub(crate) fn health(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    health_with_event(payload, 0).map(|(payload, _)| payload)
}

pub(crate) fn health_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<LocalToolRuntimeHealthPayload>(
        payload,
        host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD,
    )?;
    let operation = host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD;
    validate_health(&input, operation)?;
    ensure_supported_platform(operation)?;
    let session = get_session(input.runtime_id(), operation)?;
    let (status, reason) = match session.manifest.health() {
        Some(health) => {
            let command = command_by_id(&session.manifest, health.command_id(), operation)?;
            let run = run_command(
                command,
                &session,
                RunCommandRequest {
                    request_id: None,
                    runtime_id: input.runtime_id(),
                    args: &[],
                    run_id: generate_run_id(),
                    timeout_override: Some(health.timeout_millis()),
                    started_event: None,
                },
                operation,
            )?;
            if run_status(&run) == LocalToolRuntimeRunStatus::Completed {
                (LocalToolRuntimeHealthStatus::Healthy, None)
            } else {
                (
                    LocalToolRuntimeHealthStatus::Unhealthy,
                    Some("health command did not complete successfully".to_string()),
                )
            }
        }
        None => (
            LocalToolRuntimeHealthStatus::Unknown,
            Some("manifest does not declare a health command".to_string()),
        ),
    };
    let checked_at = if timestamp == 0 {
        timestamp_millis()
    } else {
        timestamp
    };
    let mut event = LocalToolRuntimeEventPayload::new(
        timestamp,
        input.runtime_id(),
        LocalToolRuntimeEventPhase::HealthChecked,
    )
    .with_health(session.tool_id, status);
    if let Some(reason) = reason.clone() {
        event = event.with_reason(reason);
    }

    Ok((
        encode_payload(
            LocalToolRuntimeHealthResultPayload::new(
                input.runtime_id(),
                status,
                checked_at,
                reason,
            ),
            operation,
        )?,
        vec![local_tool_runtime_event(event, operation)?],
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        return encode_payload(
            LocalToolRuntimeSupportedPayload::unsupported(
                "local-tool-runtime-platform-unsupported",
            ),
            host_protocol::LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD,
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    encode_payload(
        LocalToolRuntimeSupportedPayload::supported(),
        host_protocol::LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD,
    )
}

pub(crate) fn clear_runtime_resources_for_runtime_ids(
    runtime_ids: &[String],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for runtime_id in runtime_ids {
        terminate_active_runs(runtime_id, operation)?;
        local_tool_runtimes(operation)?.remove(runtime_id);
    }
    Ok(())
}

pub(crate) fn cancel_run_for_request_id(
    request_id: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let active = active_local_tool_run_requests(operation)?
        .get(request_id)
        .cloned();
    if let Some(run) = active {
        if let Some(child) = run.mark_stopped(operation)? {
            terminate_child(&child, run.kill_process_tree, operation)?;
        }
        return Ok(());
    }

    if pending_local_tool_run_requests(operation)?.contains(request_id) {
        canceled_local_tool_run_requests(operation)?.insert(request_id.to_string());
    }
    Ok(())
}

pub(crate) fn track_pending_run_request(
    request_id: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    pending_local_tool_run_requests(operation)?.insert(request_id.to_string());
    Ok(())
}

pub(crate) fn clear_run_request_tracking(request_id: &str) {
    clear_active_run_request(request_id);
}

fn ensure_supported_platform(operation: &'static str) -> Result<(), HostProtocolError> {
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        let _ = operation;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err(HostProtocolError::unsupported(
            "local-tool-runtime-platform-unsupported",
            operation,
        ))
    }
}

fn run_command(
    command: &LocalToolRuntimeCommandPayload,
    session: &LocalToolRuntimeSession,
    request: RunCommandRequest<'_>,
    operation: &'static str,
) -> Result<CapturedProcess, HostProtocolError> {
    let RunCommandRequest {
        request_id,
        runtime_id,
        args,
        run_id,
        timeout_override,
        started_event,
    } = request;
    let cwd = canonical_command_cwd(command, session, operation)?;
    let executable = canonical_executable(command.executable(), operation)?;
    let active_run = reserve_active_run(
        runtime_id.to_string(),
        run_id.clone(),
        session.manifest.policy().cleanup().kill_process_tree(),
        operation,
    )?;
    if let Some(request_id) = request_id {
        if !track_active_run_request(request_id.to_string(), active_run.clone(), operation)? {
            remove_active_run(runtime_id, &run_id);
            clear_active_run_request(request_id);
            return Ok(CapturedProcess {
                status: None,
                timed_out: false,
                stopped: true,
                stdout: String::new(),
                stderr: String::new(),
            });
        }
    }
    let spawn = LocalToolSpawn {
        executable: executable.clone(),
        args: command
            .default_args()
            .iter()
            .chain(args.iter())
            .cloned()
            .collect(),
        cwd,
        env: merged_environment(
            session.manifest.policy().environment().variables(),
            command.environment(),
        ),
        stdio: session.manifest.policy().stdio(),
    };

    let (child, guard, stdout, stderr) = {
        let mut state = active_run.state.lock().map_err(|_| {
            HostProtocolError::internal("local tool active run state lock poisoned", operation)
        })?;
        match &*state {
            ActiveRunState::Starting { stopped: true } => {
                remove_active_run(runtime_id, &run_id);
                if let Some(request_id) = request_id {
                    clear_active_run_request(request_id);
                }
                return Ok(CapturedProcess {
                    status: None,
                    timed_out: false,
                    stopped: true,
                    stdout: String::new(),
                    stderr: String::new(),
                });
            }
            ActiveRunState::Starting { stopped: false } => {}
            ActiveRunState::Running { .. } => {
                return Err(already_exists(
                    format!("local tool run {run_id}"),
                    operation,
                ));
            }
        }

        let spawned = match spawn_local_tool_child(spawn) {
            Ok(spawned) => spawned,
            Err(error) => {
                remove_active_run(runtime_id, &run_id);
                if let Some(request_id) = request_id {
                    clear_active_run_request(request_id);
                }
                return Err(map_spawn_error(
                    command.executable(),
                    command.command_id(),
                    &run_id,
                    error,
                    operation,
                ));
            }
        };
        let stdout = capture_stream(
            spawned.stdout,
            session.manifest.policy().budgets().stdout_bytes(),
        );
        let stderr = capture_stream(
            spawned.stderr,
            session.manifest.policy().budgets().stderr_bytes(),
        );
        let guard = spawned.guard;
        let child = Arc::new(Mutex::new(spawned.child));
        *state = ActiveRunState::Running {
            child: child.clone(),
            stopped: false,
        };
        (child, guard, stdout, stderr)
    };
    if active_run.stopped(operation)? {
        let _ = terminate_child(
            &child,
            session.manifest.policy().cleanup().kill_process_tree(),
            operation,
        );
        release_local_tool_guard(guard);
        remove_active_run(runtime_id, &run_id);
        if let Some(request_id) = request_id {
            clear_active_run_request(request_id);
        }
        return Ok(CapturedProcess {
            status: None,
            timed_out: false,
            stopped: true,
            stdout: String::new(),
            stderr: String::new(),
        });
    }
    if let Some(started_event) = started_event {
        if let Err(error) = started_event.sink.send(
            host_protocol::LOCAL_TOOL_RUNTIME_EVENT,
            started_event.timestamp,
            started_event.payload,
            operation,
        ) {
            let _ = terminate_child(
                &child,
                session.manifest.policy().cleanup().kill_process_tree(),
                operation,
            );
            remove_active_run(runtime_id, &run_id);
            if let Some(request_id) = request_id {
                clear_active_run_request(request_id);
            }
            release_local_tool_guard(guard);
            return Err(error);
        }
    }
    let timeout = Duration::from_millis(
        timeout_override.unwrap_or_else(|| session.manifest.policy().budgets().wall_clock_millis()),
    );
    let deadline = Instant::now().checked_add(timeout).ok_or_else(|| {
        HostProtocolError::invalid_argument("timeoutMillis", "overflows", operation)
    })?;
    let (status, timed_out) = wait_until_deadline(
        &child,
        deadline,
        session.manifest.policy().cleanup().kill_process_tree(),
        operation,
    )
    .inspect(|_| {
        remove_active_run(runtime_id, &run_id);
        if let Some(request_id) = request_id {
            clear_active_run_request(request_id);
        }
    })
    .inspect_err(|_| {
        remove_active_run(runtime_id, &run_id);
        if let Some(request_id) = request_id {
            clear_active_run_request(request_id);
        }
    })?;
    if session.manifest.policy().cleanup().kill_process_tree() {
        cleanup_process_tree_after_exit(&child).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to clean local tool process tree: {error}"),
                operation,
            )
        })?;
    }
    release_local_tool_guard(guard);
    let output_deadline = if timed_out || Instant::now() >= deadline {
        Instant::now()
            .checked_add(OUTPUT_DRAIN_GRACE)
            .ok_or_else(|| {
                HostProtocolError::internal("output drain deadline overflow", operation)
            })?
    } else {
        deadline
    };
    let stdout = join_output(stdout, "stdout", output_deadline, operation)?;
    let stderr = join_output(stderr, "stderr", output_deadline, operation)?;
    if stdout.exceeded {
        return Err(frame_too_large(
            stdout.observed_bytes,
            stdout.limit,
            "local tool stdout exceeded manifest budget",
            operation,
        ));
    }
    if stderr.exceeded {
        return Err(frame_too_large(
            stderr.observed_bytes,
            stderr.limit,
            "local tool stderr exceeded manifest budget",
            operation,
        ));
    }
    Ok(CapturedProcess {
        status,
        timed_out,
        stopped: active_run.stopped(operation)?,
        stdout: stdout.text,
        stderr: stderr.text,
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
            format!("failed to encode local tool runtime payload: {error}"),
            operation,
        )
    })
}

fn local_tool_runtime_event<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<EventPayload, HostProtocolError> {
    to_value(payload)
        .map(|payload| (host_protocol::LOCAL_TOOL_RUNTIME_EVENT, payload))
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode local tool runtime event payload: {error}"),
                operation,
            )
        })
}

fn insert_session(
    runtime_id: String,
    session: LocalToolRuntimeSession,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut runtimes = local_tool_runtimes(operation)?;
    if runtimes.contains_key(&runtime_id) {
        return Err(already_exists(runtime_id, operation));
    }
    runtimes.insert(runtime_id, session);
    Ok(())
}

fn reserve_active_run(
    runtime_id: String,
    run_id: String,
    kill_process_tree: bool,
    operation: &'static str,
) -> Result<ActiveRun, HostProtocolError> {
    let key = (runtime_id.clone(), run_id.clone());
    let runtimes = local_tool_runtimes(operation)?;
    if !runtimes.contains_key(&runtime_id) {
        return Err(HostProtocolError::not_found(
            format!("local tool runtime {runtime_id}"),
            operation,
        ));
    }
    let mut runs = active_local_tool_runs(operation)?;
    if runs.contains_key(&key) {
        return Err(already_exists(
            format!("local tool run {}", key.1),
            operation,
        ));
    }
    let run = ActiveRun::new(kill_process_tree);
    runs.insert(key, run.clone());
    drop(runtimes);
    Ok(run)
}

fn remove_active_run(runtime_id: &str, run_id: &str) {
    if let Ok(mut runs) = active_local_tool_runs(host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD) {
        runs.remove(&(runtime_id.to_string(), run_id.to_string()));
    }
}

fn terminate_active_runs(
    runtime_id: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let runs = {
        let active = active_local_tool_runs(operation)?;
        let keys = active
            .keys()
            .filter(|(active_runtime_id, _)| active_runtime_id == runtime_id)
            .cloned()
            .collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|key| active.get(&key).cloned().map(|run| (key, run)))
            .collect::<Vec<_>>()
    };

    for (_, run) in &runs {
        if let Some(child) = run.mark_stopped(operation)? {
            terminate_child(&child, run.kill_process_tree, operation)?;
        }
    }
    let mut active = active_local_tool_runs(operation)?;
    for (key, _) in runs {
        active.remove(&key);
    }
    Ok(())
}

fn active_local_tool_runs(operation: &'static str) -> Result<ActiveRunGuard, HostProtocolError> {
    ACTIVE_LOCAL_TOOL_RUNS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| HostProtocolError::internal("local tool active run lock poisoned", operation))
}

fn pending_local_tool_run_requests(
    operation: &'static str,
) -> Result<PendingRunRequestGuard, HostProtocolError> {
    PENDING_LOCAL_TOOL_RUN_REQUESTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map_err(|_| {
            HostProtocolError::internal("local tool pending run request lock poisoned", operation)
        })
}

fn active_local_tool_run_requests(
    operation: &'static str,
) -> Result<ActiveRunRequestGuard, HostProtocolError> {
    ACTIVE_LOCAL_TOOL_RUN_REQUESTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| {
            HostProtocolError::internal("local tool active run request lock poisoned", operation)
        })
}

fn canceled_local_tool_run_requests(
    operation: &'static str,
) -> Result<CanceledRunRequestGuard, HostProtocolError> {
    CANCELED_LOCAL_TOOL_RUN_REQUESTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map_err(|_| {
            HostProtocolError::internal("local tool canceled run request lock poisoned", operation)
        })
}

fn track_active_run_request(
    request_id: String,
    run: ActiveRun,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    pending_local_tool_run_requests(operation)?.remove(&request_id);
    if canceled_local_tool_run_requests(operation)?.remove(&request_id) {
        let _ = run.mark_stopped(operation)?;
        return Ok(false);
    }
    active_local_tool_run_requests(operation)?.insert(request_id, run);
    Ok(true)
}

fn clear_active_run_request(request_id: &str) {
    if let Ok(mut pending) =
        pending_local_tool_run_requests(host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD)
    {
        pending.remove(request_id);
    }
    if let Ok(mut requests) =
        active_local_tool_run_requests(host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD)
    {
        requests.remove(request_id);
    }
    if let Ok(mut canceled) =
        canceled_local_tool_run_requests(host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD)
    {
        canceled.remove(request_id);
    }
}

fn get_session(
    runtime_id: &str,
    operation: &'static str,
) -> Result<LocalToolRuntimeSession, HostProtocolError> {
    local_tool_runtimes(operation)?
        .get(runtime_id)
        .cloned()
        .ok_or_else(|| {
            HostProtocolError::not_found(format!("local tool runtime {runtime_id}"), operation)
        })
}

fn remove_session(
    runtime_id: &str,
    operation: &'static str,
) -> Result<LocalToolRuntimeSession, HostProtocolError> {
    local_tool_runtimes(operation)?
        .remove(runtime_id)
        .ok_or_else(|| {
            HostProtocolError::not_found(format!("local tool runtime {runtime_id}"), operation)
        })
}

fn local_tool_runtimes(operation: &'static str) -> Result<RuntimeSessionGuard, HostProtocolError> {
    LOCAL_TOOL_RUNTIMES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| {
            HostProtocolError::internal("local tool runtime session lock poisoned", operation)
        })
}

fn command_by_id<'a>(
    manifest: &'a LocalToolRuntimeManifestPayload,
    command_id: &str,
    operation: &'static str,
) -> Result<&'a LocalToolRuntimeCommandPayload, HostProtocolError> {
    manifest
        .commands()
        .iter()
        .find(|command| command.command_id() == command_id)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                "commandId",
                "must reference a manifest command",
                operation,
            )
        })
}

fn canonical_cwd_roots(
    manifest: &LocalToolRuntimeManifestPayload,
    operation: &'static str,
) -> Result<Vec<PathBuf>, HostProtocolError> {
    manifest
        .policy()
        .cwd()
        .roots()
        .iter()
        .map(|root| canonical_dir(root, "manifest.policy.cwd.roots", operation))
        .collect()
}

fn validate_command_cwds(
    manifest: &LocalToolRuntimeManifestPayload,
    roots: &[PathBuf],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for command in manifest.commands() {
        let cwd = command
            .cwd()
            .unwrap_or_else(|| manifest.policy().cwd().roots()[0].as_str());
        let canonical = canonical_dir(cwd, "manifest.commands.cwd", operation)?;
        if !roots
            .iter()
            .any(|root| path_contains_path(root, &canonical))
        {
            return Err(HostProtocolError::invalid_argument(
                "manifest.commands.cwd",
                "must be within manifest cwd roots",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_command_executables(
    manifest: &LocalToolRuntimeManifestPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for command in manifest.commands() {
        canonical_executable(command.executable(), operation)?;
    }
    Ok(())
}

fn canonical_command_cwd(
    command: &LocalToolRuntimeCommandPayload,
    session: &LocalToolRuntimeSession,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    let cwd = command
        .cwd()
        .unwrap_or_else(|| session.manifest.policy().cwd().roots()[0].as_str());
    let canonical = canonical_dir(cwd, "manifest.commands.cwd", operation)?;
    if session
        .cwd_roots
        .iter()
        .any(|root| path_contains_path(root, &canonical))
    {
        Ok(canonical)
    } else {
        Err(HostProtocolError::invalid_argument(
            "manifest.commands.cwd",
            "must be within manifest cwd roots",
            operation,
        ))
    }
}

fn canonical_executable(
    executable: &str,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    let path = Path::new(executable);
    if !path.is_absolute() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.commands.executable",
            "must be an absolute path",
            operation,
        ));
    }
    let metadata =
        fs::metadata(path).map_err(|error| map_path_error(executable, error, operation))?;
    if !metadata.is_file() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.commands.executable",
            "must reference an existing file",
            operation,
        ));
    }
    fs::canonicalize(path).map_err(|error| map_path_error(executable, error, operation))
}

fn canonical_dir(
    path: &str,
    field: &str,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    let metadata = fs::metadata(path).map_err(|error| map_path_error(path, error, operation))?;
    if !metadata.is_dir() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must reference an existing directory",
            operation,
        ));
    }
    fs::canonicalize(path).map_err(|error| map_path_error(path, error, operation))
}

fn map_path_error(path: &str, error: io::Error, operation: &'static str) -> HostProtocolError {
    match error.kind() {
        io::ErrorKind::NotFound => HostProtocolError::not_found(path, operation),
        io::ErrorKind::PermissionDenied => HostProtocolError::PermissionDenied {
            capability: "filesystem.read".to_string(),
            resource: Some(path.to_string()),
            message: format!("permission denied reading {path}"),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("PermissionDenied")
                .expect("known tag"),
            remediation: None,
            docs_url: None,
        },
        _ => HostProtocolError::internal(format!("failed to inspect {path}: {error}"), operation),
    }
}

fn map_spawn_error(
    executable: &str,
    command_id: &str,
    run_id: &str,
    error: io::Error,
    operation: &'static str,
) -> HostProtocolError {
    match error.kind() {
        io::ErrorKind::NotFound => HostProtocolError::not_found(executable, operation),
        io::ErrorKind::PermissionDenied => HostProtocolError::PermissionDenied {
            capability: "process.spawn".to_string(),
            resource: Some(executable.to_string()),
            message: format!("permission denied spawning {executable}"),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: Some(Value::String(format!(
                "failed to spawn local tool command {command_id} for {run_id}: {error}"
            ))),
            recoverable: HostProtocolError::recoverable_default("PermissionDenied")
                .expect("known tag"),
            remediation: None,
            docs_url: None,
        },
        io::ErrorKind::InvalidInput | io::ErrorKind::Unsupported | io::ErrorKind::Other => {
            HostProtocolError::invalid_argument(
                "manifest.commands.executable",
                format!("failed to execute {executable}: {error}"),
                operation,
            )
        }
        _ => HostProtocolError::internal(
            format!("failed to spawn local tool command {command_id} for {run_id}: {error}"),
            operation,
        ),
    }
}

fn path_contains_path(root: &Path, path: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn merged_environment(
    policy_entries: &[host_protocol::LocalToolRuntimeEnvironmentEntryPayload],
    command_entries: &[host_protocol::LocalToolRuntimeEnvironmentEntryPayload],
) -> Vec<(String, String)> {
    let mut env = BTreeMap::new();
    for entry in policy_entries.iter().chain(command_entries.iter()) {
        env.insert(entry.name().to_string(), entry.value().to_string());
    }
    env.into_iter().collect()
}

fn apply_stdio(command: &mut Command, stdio: &host_protocol::LocalToolRuntimeStdioPolicyPayload) {
    command.stdin(Stdio::null());
    command.stdout(stdio_for_mode(stdio.stdout()));
    command.stderr(stdio_for_mode(stdio.stderr()));
}

fn stdio_for_mode(mode: LocalToolRuntimeStdioMode) -> Stdio {
    match mode {
        LocalToolRuntimeStdioMode::Capture => Stdio::piped(),
        LocalToolRuntimeStdioMode::Inherit => Stdio::inherit(),
        LocalToolRuntimeStdioMode::Ignore => Stdio::null(),
    }
}

#[cfg(not(windows))]
fn spawn_local_tool_child(mut spawn: LocalToolSpawn<'_>) -> io::Result<SpawnedLocalToolChild> {
    let mut command = Command::new(spawn.executable);
    command
        .args(spawn.args)
        .current_dir(spawn.cwd)
        .env_clear()
        .envs(spawn.env.drain(..));
    apply_stdio(&mut command, spawn.stdio);
    platform::configure_command(&mut command);

    let mut child = command.spawn()?;
    let guard = platform::ChildGuard::attach(&child).inspect_err(|_| {
        let _ = child.kill();
        let _ = child.wait();
    })?;
    let stdout = child
        .stdout
        .take()
        .map(|stream| Box::new(stream) as Box<dyn Read + Send>);
    let stderr = child
        .stderr
        .take()
        .map(|stream| Box::new(stream) as Box<dyn Read + Send>);

    Ok(SpawnedLocalToolChild {
        child: LocalToolChild::new(child),
        guard: LocalToolChildGuard::Platform(guard),
        stdout,
        stderr,
    })
}

#[cfg(not(windows))]
fn release_local_tool_guard(guard: LocalToolChildGuard) {
    match guard {
        LocalToolChildGuard::Platform(guard) => platform::release_child_guard(guard),
    }
}

#[cfg(not(windows))]
fn request_child_tree_termination(child: &mut LocalToolChild) -> io::Result<()> {
    platform::request_termination(&mut child.child)
}

#[cfg(not(windows))]
fn force_child_tree_termination(child: &mut LocalToolChild) -> io::Result<()> {
    platform::force_termination(&mut child.child)
}

#[cfg(not(windows))]
fn cleanup_process_tree_after_exit(child: &Arc<Mutex<LocalToolChild>>) -> io::Result<()> {
    let child = child
        .lock()
        .map_err(|_| io::Error::other("local tool child lock poisoned"))?;
    platform::cleanup_process_tree_after_exit(&child.child)
}

#[cfg(windows)]
fn release_local_tool_guard(_guard: LocalToolChildGuard) {}

#[cfg(windows)]
fn request_child_tree_termination(child: &mut LocalToolChild) -> io::Result<()> {
    child.terminate_tree()
}

#[cfg(windows)]
fn force_child_tree_termination(child: &mut LocalToolChild) -> io::Result<()> {
    child.force_terminate_tree()
}

#[cfg(windows)]
fn cleanup_process_tree_after_exit(child: &Arc<Mutex<LocalToolChild>>) -> io::Result<()> {
    let child = child
        .lock()
        .map_err(|_| io::Error::other("local tool child lock poisoned"))?;
    child.cleanup_process_tree_after_exit()
}

#[cfg(windows)]
fn spawn_local_tool_child(spawn: LocalToolSpawn<'_>) -> io::Result<SpawnedLocalToolChild> {
    use std::{mem::size_of, ptr::null};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            CreateProcessW, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED,
            CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION,
            STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    };

    let job = create_kill_on_close_job()?;
    let mut handles = WindowsSpawnHandles::new();
    let stdout = handles.stdout_for_mode(spawn.stdio.stdout())?;
    let stderr = handles.stderr_for_mode(spawn.stdio.stderr())?;
    let stdin = handles.stdin_null()?;

    let mut inherit_handles = handles.inheritable_handles();
    let mut attribute_list =
        WindowsProcThreadAttributeList::for_job_and_handles(job, inherit_handles.as_mut_slice())?;
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin;
    startup.StartupInfo.hStdOutput = handles.child_stdout;
    startup.StartupInfo.hStdError = handles.child_stderr;
    startup.lpAttributeList = attribute_list.as_mut_ptr();

    let application = encode_wide(spawn.executable.as_os_str());
    let mut command_line =
        encode_wide_string(&windows_command_line(&spawn.executable, &spawn.args));
    let current_dir = encode_wide(spawn.cwd.as_os_str());
    let environment = windows_environment_block(spawn.env);
    let mut process = PROCESS_INFORMATION::default();
    let creation_flags = EXTENDED_STARTUPINFO_PRESENT
        | CREATE_SUSPENDED
        | CREATE_UNICODE_ENVIRONMENT
        | CREATE_NO_WINDOW;

    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null(),
            null(),
            1,
            creation_flags,
            environment.as_ptr().cast(),
            current_dir.as_ptr(),
            &startup.StartupInfo,
            &mut process,
        )
    };
    if created == 0 {
        unsafe {
            CloseHandle(job);
        }
        return Err(io::Error::last_os_error());
    }

    handles.close_child_side();
    let resumed = unsafe { ResumeThread(process.hThread) };
    if resumed == u32::MAX {
        unsafe {
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            CloseHandle(job);
        }
        return Err(io::Error::last_os_error());
    }

    Ok(SpawnedLocalToolChild {
        child: LocalToolChild {
            process: process.hProcess,
            thread: process.hThread,
            job,
        },
        guard: LocalToolChildGuard,
        stdout,
        stderr,
    })
}

#[cfg(windows)]
struct WindowsSpawnHandles {
    child_stdout: WindowsHandle,
    child_stderr: WindowsHandle,
    parent_stdout: Option<WindowsHandle>,
    parent_stderr: Option<WindowsHandle>,
    child_stdin: WindowsHandle,
    parent_stdin: WindowsHandle,
}

#[cfg(windows)]
impl WindowsSpawnHandles {
    fn new() -> Self {
        Self {
            child_stdout: std::ptr::null_mut(),
            child_stderr: std::ptr::null_mut(),
            parent_stdout: None,
            parent_stderr: None,
            child_stdin: std::ptr::null_mut(),
            parent_stdin: std::ptr::null_mut(),
        }
    }

    fn stdout_for_mode(
        &mut self,
        mode: LocalToolRuntimeStdioMode,
    ) -> io::Result<Option<Box<dyn Read + Send>>> {
        let (child, parent) = output_handle_for_mode(mode)?;
        self.child_stdout = child;
        self.parent_stdout = parent;
        Ok(parent.map(handle_to_reader))
    }

    fn stderr_for_mode(
        &mut self,
        mode: LocalToolRuntimeStdioMode,
    ) -> io::Result<Option<Box<dyn Read + Send>>> {
        let (child, parent) = output_handle_for_mode(mode)?;
        self.child_stderr = child;
        self.parent_stderr = parent;
        Ok(parent.map(handle_to_reader))
    }

    fn stdin_null(&mut self) -> io::Result<WindowsHandle> {
        let (read, write) = inheritable_pipe()?;
        clear_handle_inherit(write)?;
        self.child_stdin = read;
        self.parent_stdin = write;
        Ok(read)
    }

    fn inheritable_handles(&self) -> Vec<WindowsHandle> {
        vec![self.child_stdin, self.child_stdout, self.child_stderr]
    }

    fn close_child_side(&mut self) {
        unsafe {
            close_if_live(self.child_stdout);
            close_if_live(self.child_stderr);
            close_if_live(self.child_stdin);
            close_if_live(self.parent_stdin);
        }
        self.child_stdout = std::ptr::null_mut();
        self.child_stderr = std::ptr::null_mut();
        self.child_stdin = std::ptr::null_mut();
        self.parent_stdin = std::ptr::null_mut();
    }
}

#[cfg(windows)]
impl Drop for WindowsSpawnHandles {
    fn drop(&mut self) {
        unsafe {
            close_if_live(self.child_stdout);
            close_if_live(self.child_stderr);
            close_if_live(self.child_stdin);
            close_if_live(self.parent_stdin);
        }
    }
}

#[cfg(windows)]
struct WindowsProcThreadAttributeList {
    heap: WindowsHandle,
    ptr: windows_sys::Win32::System::Threading::LPPROC_THREAD_ATTRIBUTE_LIST,
    job_list: [WindowsHandle; 1],
    initialized: bool,
}

#[cfg(windows)]
impl WindowsProcThreadAttributeList {
    fn for_job_and_handles(job: WindowsHandle, handles: &mut [WindowsHandle]) -> io::Result<Self> {
        use std::{
            mem::size_of,
            ptr::{null, null_mut},
        };
        use windows_sys::Win32::System::{
            Memory::{GetProcessHeap, HeapAlloc, HEAP_ZERO_MEMORY},
            Threading::{
                InitializeProcThreadAttributeList, UpdateProcThreadAttribute,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST,
            },
        };

        let mut size = 0_usize;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut size);
        }
        let heap = unsafe { GetProcessHeap() };
        if heap.is_null() {
            return Err(io::Error::last_os_error());
        }
        let ptr = unsafe { HeapAlloc(heap, HEAP_ZERO_MEMORY, size) };
        if ptr.is_null() {
            return Err(io::Error::last_os_error());
        }
        let mut list = Self {
            heap,
            ptr: ptr.cast(),
            job_list: [job],
            initialized: false,
        };

        let initialized = unsafe { InitializeProcThreadAttributeList(list.ptr, 2, 0, &mut size) };
        if initialized == 0 {
            return Err(io::Error::last_os_error());
        }
        list.initialized = true;
        let updated = unsafe {
            UpdateProcThreadAttribute(
                list.ptr,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                list.job_list.as_ptr().cast(),
                size_of::<WindowsHandle>(),
                null_mut(),
                null(),
            )
        };
        if updated == 0 {
            return Err(io::Error::last_os_error());
        }
        let updated = unsafe {
            UpdateProcThreadAttribute(
                list.ptr,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_mut_ptr().cast(),
                std::mem::size_of_val(handles),
                null_mut(),
                null(),
            )
        };
        if updated == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(list)
    }

    fn as_mut_ptr(
        &mut self,
    ) -> windows_sys::Win32::System::Threading::LPPROC_THREAD_ATTRIBUTE_LIST {
        self.ptr
    }
}

#[cfg(windows)]
impl Drop for WindowsProcThreadAttributeList {
    fn drop(&mut self) {
        use windows_sys::Win32::System::{
            Memory::HeapFree, Threading::DeleteProcThreadAttributeList,
        };

        unsafe {
            if self.initialized {
                DeleteProcThreadAttributeList(self.ptr);
            }
            HeapFree(self.heap, 0, self.ptr.cast());
        }
    }
}

#[cfg(windows)]
fn create_kill_on_close_job() -> io::Result<WindowsHandle> {
    use std::{mem::size_of, ptr::null};
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let job = unsafe { CreateJobObjectW(null(), null()) };
    if job.is_null() {
        return Err(io::Error::last_os_error());
    }

    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(job);
        }
        return Err(io::Error::last_os_error());
    }
    Ok(job)
}

#[cfg(windows)]
fn output_handle_for_mode(
    mode: LocalToolRuntimeStdioMode,
) -> io::Result<(WindowsHandle, Option<WindowsHandle>)> {
    match mode {
        LocalToolRuntimeStdioMode::Capture => {
            let (read, write) = inheritable_pipe()?;
            clear_handle_inherit(read)?;
            Ok((write, Some(read)))
        }
        LocalToolRuntimeStdioMode::Ignore => Ok((nul_write_handle()?, None)),
        LocalToolRuntimeStdioMode::Inherit => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "inherited stdio is rejected before spawn",
        )),
    }
}

#[cfg(windows)]
fn inheritable_pipe() -> io::Result<(WindowsHandle, WindowsHandle)> {
    use std::ptr::null_mut;
    use windows_sys::Win32::{Security::SECURITY_ATTRIBUTES, System::Pipes::CreatePipe};

    let mut read = null_mut();
    let mut write = null_mut();
    let mut security = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let created = unsafe { CreatePipe(&mut read, &mut write, &mut security, 0) };
    if created == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok((read, write))
    }
}

#[cfg(windows)]
fn clear_handle_inherit(handle: WindowsHandle) -> io::Result<()> {
    use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT};

    let updated = unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) };
    if updated == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn nul_write_handle() -> io::Result<WindowsHandle> {
    use std::ptr::null_mut;
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        Security::SECURITY_ATTRIBUTES,
        Storage::FileSystem::{
            CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_WRITE, FILE_SHARE_READ,
            FILE_SHARE_WRITE, OPEN_EXISTING,
        },
    };

    let path = encode_wide_string("NUL");
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            FILE_GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: null_mut(),
                bInheritHandle: 1,
            },
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        Err(io::Error::last_os_error())
    } else {
        Ok(handle)
    }
}

#[cfg(windows)]
fn handle_to_reader(handle: WindowsHandle) -> Box<dyn Read + Send> {
    use std::{fs::File, os::windows::io::FromRawHandle};

    let file = unsafe { File::from_raw_handle(handle.cast()) };
    Box::new(file)
}

#[cfg(windows)]
unsafe fn close_if_live(handle: WindowsHandle) {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};

    if !handle.is_null() && handle != INVALID_HANDLE_VALUE {
        CloseHandle(handle);
    }
}

#[cfg(windows)]
fn windows_command_line(executable: &Path, args: &[String]) -> String {
    std::iter::once(executable.display().to_string())
        .chain(args.iter().cloned())
        .map(|arg| windows_quote_arg(&arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(windows)]
fn windows_quote_arg(value: &str) -> String {
    if value.is_empty()
        || value
            .bytes()
            .any(|byte| matches!(byte, b' ' | b'\t' | b'"'))
    {
        let mut quoted = String::from("\"");
        let mut backslashes = 0;
        for character in value.chars() {
            if character == '\\' {
                backslashes += 1;
            } else if character == '"' {
                quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            } else {
                quoted.push_str(&"\\".repeat(backslashes));
                quoted.push(character);
                backslashes = 0;
            }
        }
        quoted.push_str(&"\\".repeat(backslashes * 2));
        quoted.push('"');
        quoted
    } else {
        value.to_string()
    }
}

#[cfg(windows)]
fn windows_environment_block(entries: Vec<(String, String)>) -> Vec<u16> {
    let mut block = Vec::new();
    for (key, value) in entries {
        block.extend(encode_wide_string(&format!("{key}={value}")));
    }
    block.push(0);
    block
}

#[cfg(windows)]
fn encode_wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn encode_wide_string(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn wait_until_deadline(
    child: &Arc<Mutex<LocalToolChild>>,
    deadline: Instant,
    kill_process_tree: bool,
    operation: &'static str,
) -> Result<(Option<ExitStatus>, bool), HostProtocolError> {
    loop {
        if let Some(status) = lock_child(child, operation)?.try_wait().map_err(|error| {
            HostProtocolError::internal(
                format!("failed to poll local tool process: {error}"),
                operation,
            )
        })? {
            return Ok((Some(status), false));
        }
        if Instant::now() >= deadline {
            terminate_child(child, kill_process_tree, operation)?;
            let status = lock_child(child, operation)?.try_wait().ok().flatten();
            return Ok((status, true));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn terminate_child(
    child: &Arc<Mutex<LocalToolChild>>,
    kill_process_tree: bool,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if lock_child(child, operation)?
        .try_wait()
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to poll local tool process before termination: {error}"),
                operation,
            )
        })?
        .is_some()
    {
        return Ok(());
    }

    if kill_process_tree {
        let mut locked_child = lock_child(child, operation)?;
        request_child_tree_termination(&mut locked_child).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to request local tool termination: {error}"),
                operation,
            )
        })?;
        drop(locked_child);
        if wait_for_child_exit(child, Instant::now() + TERMINATION_GRACE, operation)?.is_none() {
            let mut locked_child = lock_child(child, operation)?;
            force_child_tree_termination(&mut locked_child).map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to force local tool termination: {error}"),
                    operation,
                )
            })?;
        }
    } else {
        let kill_result = lock_child(child, operation)?.kill();
        if let Err(error) = kill_result {
            if error.kind() != io::ErrorKind::InvalidInput {
                return Err(HostProtocolError::internal(
                    format!("failed to kill local tool process: {error}"),
                    operation,
                ));
            }
        }
    }
    if wait_for_child_exit(child, Instant::now() + FORCE_TERMINATION_WAIT, operation)?.is_none() {
        return Err(HostProtocolError::internal(
            "local tool process did not exit after termination",
            operation,
        ));
    }
    Ok(())
}

fn wait_for_child_exit(
    child: &Arc<Mutex<LocalToolChild>>,
    deadline: Instant,
    operation: &'static str,
) -> Result<Option<ExitStatus>, HostProtocolError> {
    loop {
        if let Some(status) = lock_child(child, operation)?.try_wait().map_err(|error| {
            HostProtocolError::internal(
                format!("failed to poll local tool process after termination: {error}"),
                operation,
            )
        })? {
            return Ok(Some(status));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn lock_child<'a>(
    child: &'a Arc<Mutex<LocalToolChild>>,
    operation: &'static str,
) -> Result<std::sync::MutexGuard<'a, LocalToolChild>, HostProtocolError> {
    child
        .lock()
        .map_err(|_| HostProtocolError::internal("local tool child lock poisoned", operation))
}

fn capture_stream(stream: Option<Box<dyn Read + Send>>, limit: u64) -> Option<CapturedStream> {
    stream.map(|mut stream| {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut output = Vec::new();
            let mut exceeded = false;
            let mut buffer = [0_u8; 8192];
            let mut observed_bytes = 0_u64;
            loop {
                let read = match stream.read(&mut buffer) {
                    Ok(read) => read,
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        return;
                    }
                };
                if read == 0 {
                    break;
                }
                observed_bytes = observed_bytes.saturating_add(read as u64);
                let allowed = limit.saturating_sub(output.len() as u64) as usize;
                if read > allowed {
                    exceeded = true;
                    output.extend_from_slice(&buffer[..allowed]);
                } else {
                    output.extend_from_slice(&buffer[..read]);
                }
            }
            let _ = sender.send(Ok(ProcessOutput {
                text: String::from_utf8_lossy(&output).into_owned(),
                exceeded,
                limit,
                observed_bytes,
            }));
        });
        CapturedStream { receiver }
    })
}

fn join_output(
    captured: Option<CapturedStream>,
    stream_name: &str,
    deadline: Instant,
    operation: &'static str,
) -> Result<ProcessOutput, HostProtocolError> {
    match captured {
        Some(captured) => match captured.receiver.recv_timeout(remaining_timeout(deadline)) {
            Ok(output) => output.map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to read local tool {stream_name}: {error}"),
                    operation,
                )
            }),
            Err(RecvTimeoutError::Timeout) => Err(HostProtocolError::internal(
                format!("timed out reading local tool {stream_name}"),
                operation,
            )),
            Err(RecvTimeoutError::Disconnected) => Err(HostProtocolError::internal(
                format!("local tool {stream_name} reader exited without output"),
                operation,
            )),
        },
        None => Ok(ProcessOutput {
            text: String::new(),
            exceeded: false,
            limit: 0,
            observed_bytes: 0,
        }),
    }
}

fn remaining_timeout(deadline: Instant) -> Duration {
    deadline.saturating_duration_since(Instant::now())
}

fn already_exists(resource: String, operation: &'static str) -> HostProtocolError {
    HostProtocolError::AlreadyExists {
        resource: resource.clone(),
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

fn run_status(run: &CapturedProcess) -> LocalToolRuntimeRunStatus {
    if run.timed_out {
        LocalToolRuntimeRunStatus::Timeout
    } else if run.status.is_some_and(|status| status.success()) {
        LocalToolRuntimeRunStatus::Completed
    } else {
        LocalToolRuntimeRunStatus::Failed
    }
}

fn frame_too_large(
    size_bytes: u64,
    limit_bytes: u64,
    message: impl Into<String>,
    operation: &'static str,
) -> HostProtocolError {
    HostProtocolError::FrameTooLarge {
        size_bytes,
        limit_bytes,
        message: message.into(),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("FrameTooLarge").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn generate_runtime_id() -> String {
    format!("local-tool-runtime-{}", Uuid::new_v4())
}

fn generate_run_id() -> String {
    format!("local-tool-run-{}", Uuid::new_v4())
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after Unix epoch")
        .as_millis()
        .try_into()
        .expect("timestamp milliseconds should fit in u64")
}

fn validate_register(
    input: &LocalToolRuntimeRegisterPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_identifier("manifest.toolId", input.manifest().tool_id(), operation)?;
    validate_version("manifest.version", input.manifest().version(), operation)?;
    if input.manifest().commands().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.commands",
            "must not be empty",
            operation,
        ));
    }
    if input.manifest().permissions().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.permissions",
            "must not be empty",
            operation,
        ));
    }
    if input.manifest().policy().cwd().roots().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.policy.cwd.roots",
            "must not be empty",
            operation,
        ));
    }
    for root in input.manifest().policy().cwd().roots() {
        validate_printable_non_empty("manifest.policy.cwd.roots", root, operation)?;
    }
    for entry in input.manifest().policy().environment().variables() {
        validate_printable_non_empty("manifest.policy.environment.name", entry.name(), operation)?;
        validate_no_nul(
            "manifest.policy.environment.value",
            entry.value(),
            operation,
        )?;
    }
    for root in input.manifest().policy().filesystem().read_roots() {
        validate_printable_non_empty("manifest.policy.filesystem.readRoots", root, operation)?;
    }
    for root in input.manifest().policy().filesystem().write_roots() {
        validate_printable_non_empty("manifest.policy.filesystem.writeRoots", root, operation)?;
    }
    for host in input.manifest().policy().network().hosts() {
        validate_printable_non_empty("manifest.policy.network.hosts", host, operation)?;
    }
    validate_budget(
        "manifest.policy.budgets.cpuMillis",
        input.manifest().policy().budgets().cpu_millis(),
        operation,
    )?;
    validate_unenforced_os_budget(
        "manifest.policy.budgets.cpuMillis",
        input.manifest().policy().budgets().cpu_millis(),
        "local-tool-runtime-cpu-budget-unimplemented",
        operation,
    )?;
    validate_budget(
        "manifest.policy.budgets.memoryBytes",
        input.manifest().policy().budgets().memory_bytes(),
        operation,
    )?;
    validate_unenforced_os_budget(
        "manifest.policy.budgets.memoryBytes",
        input.manifest().policy().budgets().memory_bytes(),
        "local-tool-runtime-memory-budget-unimplemented",
        operation,
    )?;
    validate_budget(
        "manifest.policy.budgets.wallClockMillis",
        input.manifest().policy().budgets().wall_clock_millis(),
        operation,
    )?;
    validate_budget(
        "manifest.policy.budgets.stdoutBytes",
        input.manifest().policy().budgets().stdout_bytes(),
        operation,
    )?;
    validate_budget(
        "manifest.policy.budgets.stderrBytes",
        input.manifest().policy().budgets().stderr_bytes(),
        operation,
    )?;
    if input.manifest().policy().stdio().stdout() == LocalToolRuntimeStdioMode::Inherit
        || input.manifest().policy().stdio().stderr() == LocalToolRuntimeStdioMode::Inherit
    {
        return Err(HostProtocolError::unsupported(
            "local-tool-runtime-inherited-stdio-unsafe",
            operation,
        ));
    }
    if input
        .manifest()
        .policy()
        .cleanup()
        .remove_working_directory()
    {
        return Err(HostProtocolError::unsupported(
            "local-tool-runtime-remove-working-directory-unimplemented",
            operation,
        ));
    }

    let mut command_ids = Vec::new();
    for command in input.manifest().commands() {
        validate_identifier(
            "manifest.commands.commandId",
            command.command_id(),
            operation,
        )?;
        validate_printable_non_empty(
            "manifest.commands.executable",
            command.executable(),
            operation,
        )?;
        validate_no_shell_metacharacter(
            "manifest.commands.executable",
            command.executable(),
            operation,
        )?;
        if command_ids.iter().any(|id| id == command.command_id()) {
            return Err(HostProtocolError::invalid_argument(
                "manifest.commands",
                "must have unique commandIds",
                operation,
            ));
        }
        command_ids.push(command.command_id().to_string());
        for arg in command.default_args() {
            validate_no_nul("manifest.commands.defaultArgs", arg, operation)?;
        }
        for entry in command.environment() {
            validate_printable_non_empty(
                "manifest.commands.environment.name",
                entry.name(),
                operation,
            )?;
            validate_no_nul(
                "manifest.commands.environment.value",
                entry.value(),
                operation,
            )?;
        }
        if let Some(cwd) = command.cwd() {
            validate_printable_non_empty("manifest.commands.cwd", cwd, operation)?;
        }
        if let Some(timeout) = command.timeout_millis() {
            validate_budget("manifest.commands.timeoutMillis", timeout, operation)?;
        }
    }
    if let Some(health) = input.manifest().health() {
        if !command_ids.iter().any(|id| id == health.command_id()) {
            return Err(HostProtocolError::invalid_argument(
                "manifest.health.commandId",
                "must reference a manifest command",
                operation,
            ));
        }
        validate_budget(
            "manifest.health.intervalMillis",
            health.interval_millis(),
            operation,
        )?;
        validate_budget(
            "manifest.health.timeoutMillis",
            health.timeout_millis(),
            operation,
        )?;
    }
    if let Some(runtime_id) = input.runtime_id() {
        validate_non_empty("runtimeId", runtime_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_run(
    input: &LocalToolRuntimeRunPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("runtimeId", input.runtime_id(), operation)?;
    validate_identifier("commandId", input.command_id(), operation)?;
    for arg in input.args() {
        validate_no_nul("args", arg, operation)?;
    }
    if let Some(run_id) = input.run_id() {
        validate_non_empty("runId", run_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_stop(
    input: &LocalToolRuntimeStopPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("runtimeId", input.runtime_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_health(
    input: &LocalToolRuntimeHealthPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("runtimeId", input.runtime_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &LocalToolRuntimeActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_version(
    field: &str,
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
    part == "0" || !part.starts_with('0')
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

fn validate_budget(
    field: &str,
    value: u64,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value == 0 {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be greater than zero",
            operation,
        ));
    }
    Ok(())
}

fn validate_unenforced_os_budget(
    _field: &str,
    value: u64,
    reason: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value != UNBOUNDED_OS_BUDGET {
        return Err(HostProtocolError::unsupported(reason, operation));
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

fn validate_no_shell_metacharacter(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains("$(") || value.chars().any(is_shell_metacharacter) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "contains shell metacharacters",
            operation,
        ));
    }
    Ok(())
}

fn is_shell_metacharacter(value: char) -> bool {
    matches!(value, ';' | '|' | '&' | '>' | '<' | '`' | '\n')
}

#[cfg(test)]
mod tests {
    use super::{
        health, is_supported, register, register_with_event, run, run_with_event_sink, stop,
        RuntimeEventSink, UNBOUNDED_OS_BUDGET,
    };
    use host_protocol::{HostProtocolEnvelope, HostProtocolError};
    use serde_json::json;
    use std::{
        env, fs,
        path::{Path, PathBuf},
        sync::mpsc,
    };
    use uuid::Uuid;

    #[test]
    fn register_stores_valid_payload_and_reports_supported() {
        let root = temp_dir("register-supported");
        let payload = valid_register_payload(&root, "runtime-register");
        let response = register(Some(payload)).expect("register should succeed");

        let response = response.expect("register should return payload");
        assert_eq!(response["runtimeId"], json!("runtime-register"));
        assert_eq!(response["toolId"], json!("tool-1"));
        assert_eq!(response["state"], json!("registered"));
        assert_eq!(response["manifest"]["toolId"], json!("tool-1"));
        assert_eq!(
            response["manifest"]["commands"][0]["commandId"],
            json!("help")
        );
        assert_eq!(
            is_supported().expect("support payload should encode"),
            Some(json!({ "supported": true }))
        );
    }

    #[test]
    fn register_emits_registered_event() {
        let root = temp_dir("register-event");
        let (_payload, events) = register_with_event(
            Some(valid_register_payload(&root, "runtime-event")),
            1710000000400,
        )
        .expect("register should succeed");

        assert_eq!(
            events,
            vec![(
                host_protocol::LOCAL_TOOL_RUNTIME_EVENT,
                json!({
                    "type": "local-tool-runtime-event",
                    "timestamp": 1710000000400_u64,
                    "runtimeId": "runtime-event",
                    "toolId": "tool-1",
                    "phase": "registered"
                })
            )]
        );
    }

    #[test]
    fn register_rejects_duplicate_runtime_id() {
        let root = temp_dir("register-duplicate");
        register(Some(valid_register_payload(&root, "runtime-duplicate")))
            .expect("first register should succeed");
        let error = register(Some(valid_register_payload(&root, "runtime-duplicate")))
            .expect_err("duplicate runtime should fail");

        assert_eq!(error.tag(), "AlreadyExists");
    }

    #[test]
    fn register_rejects_missing_executable_before_side_effects() {
        let root = temp_dir("register-missing-executable");
        let mut payload = valid_register_payload(&root, "runtime-missing-executable");
        payload["manifest"]["commands"][0]["executable"] =
            json!(root.join("missing-tool").display().to_string());
        let error = register(Some(payload)).expect_err("missing executable should fail");

        assert_eq!(error.tag(), "NotFound");
        assert!(matches!(
            run(Some(json!({
                "runtimeId": "runtime-missing-executable",
                "commandId": "help"
            }))),
            Err(HostProtocolError::NotFound { .. })
        ));
    }

    #[test]
    fn register_rejects_inherited_stdio_before_side_effects() {
        let root = temp_dir("register-inherit-stdio");
        let mut payload = valid_register_payload(&root, "runtime-inherit-stdio");
        payload["manifest"]["policy"]["stdio"]["stdout"] = json!("inherit");
        let error = register(Some(payload)).expect_err("inherited stdio should fail closed");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                "local-tool-runtime-inherited-stdio-unsafe",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
        assert!(matches!(
            run(Some(json!({
                "runtimeId": "runtime-inherit-stdio",
                "commandId": "help"
            }))),
            Err(HostProtocolError::NotFound { .. })
        ));
    }

    #[test]
    fn run_executes_registered_command_and_captures_output() {
        let root = temp_dir("run-captures-output");
        register(Some(valid_register_payload(&root, "runtime-run")))
            .expect("register should succeed");

        let response = run(Some(json!({
            "runtimeId": "runtime-run",
            "commandId": "help",
            "runId": "run-1"
        })))
        .expect("run should succeed")
        .expect("run should return payload");

        assert_eq!(response["runtimeId"], json!("runtime-run"));
        assert_eq!(response["commandId"], json!("help"));
        assert_eq!(response["runId"], json!("run-1"));
        assert_eq!(response["status"], json!("completed"));
        assert!(
            response["stdout"]
                .as_str()
                .unwrap_or_default()
                .contains("Usage"),
            "expected test binary help output, got {response:?}"
        );
    }

    #[test]
    fn run_rejects_unknown_command_before_spawn() {
        let root = temp_dir("run-unknown-command");
        register(Some(valid_register_payload(
            &root,
            "runtime-missing-command",
        )))
        .expect("register should succeed");
        let error = run(Some(json!({
            "runtimeId": "runtime-missing-command",
            "commandId": "missing"
        })))
        .expect_err("unknown command should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "commandId",
                "must reference a manifest command",
                host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
            )
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_with_event_sink_does_not_emit_started_before_spawn_succeeds() {
        let root = temp_dir("run-start-event-spawn-failure");
        let executable = root.join("not-executable.sh");
        fs::write(&executable, "#!/bin/sh\nprintf never\n").expect("script should write");
        let payload = register_payload_with_command(
            &root,
            "runtime-spawn-failure",
            "not-executable",
            &executable,
            vec![],
            vec![],
        );
        register(Some(payload)).expect("register should succeed");
        let (sender, receiver) = mpsc::channel::<HostProtocolEnvelope>();
        let sink = RuntimeEventSink::new(sender, "trace-spawn-failure".to_string(), None);

        let error = run_with_event_sink(
            Some(json!({
                "runtimeId": "runtime-spawn-failure",
                "commandId": "not-executable",
                "runId": "run-spawn-failure"
            })),
            1710000000500,
            Some(sink),
        )
        .expect_err("spawn failure should not return a run result");

        assert_eq!(error.tag(), "PermissionDenied");
        assert!(
            receiver.try_recv().is_err(),
            "run-started must not be emitted when spawn fails"
        );
    }

    #[test]
    fn run_enforces_stdout_budget() {
        let root = temp_dir("run-output-limit");
        let mut payload = valid_register_payload(&root, "runtime-output-limit");
        payload["manifest"]["policy"]["budgets"]["stdoutBytes"] = json!(1);
        register(Some(payload)).expect("register should succeed");
        let error = run(Some(json!({
            "runtimeId": "runtime-output-limit",
            "commandId": "help"
        })))
        .expect_err("stdout limit should fail");

        assert_eq!(error.tag(), "FrameTooLarge");
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn run_enforces_stderr_budget() {
        let root = temp_dir("run-stderr-limit");
        let command = stderr_command(&root);
        let mut payload = register_payload_with_command(
            &root,
            "runtime-stderr-limit",
            "stderr",
            &command.executable,
            command.args,
            vec![],
        );
        payload["manifest"]["policy"]["budgets"]["stderrBytes"] = json!(1);
        register(Some(payload)).expect("register should succeed");
        let error = run(Some(json!({
            "runtimeId": "runtime-stderr-limit",
            "commandId": "stderr"
        })))
        .expect_err("stderr limit should fail");

        assert_eq!(error.tag(), "FrameTooLarge");
    }

    #[test]
    fn register_rejects_constrained_cpu_and_memory_budgets_until_host_enforces_them() {
        let root = temp_dir("register-os-budget");
        let mut cpu_payload = valid_register_payload(&root, "runtime-cpu-budget");
        cpu_payload["manifest"]["policy"]["budgets"]["cpuMillis"] = json!(500);
        let cpu_error = register(Some(cpu_payload)).expect_err("cpu budget should fail closed");
        assert_eq!(
            cpu_error,
            HostProtocolError::unsupported(
                "local-tool-runtime-cpu-budget-unimplemented",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );

        let mut memory_payload = valid_register_payload(&root, "runtime-memory-budget");
        memory_payload["manifest"]["policy"]["budgets"]["memoryBytes"] = json!(67_108_864);
        let memory_error =
            register(Some(memory_payload)).expect_err("memory budget should fail closed");
        assert_eq!(
            memory_error,
            HostProtocolError::unsupported(
                "local-tool-runtime-memory-budget-unimplemented",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn run_reports_process_failure_and_captures_stderr() {
        let root = temp_dir("run-process-failure");
        let command = failure_command(&root);
        let payload = register_payload_with_command(
            &root,
            "runtime-process-failure",
            "fail",
            &command.executable,
            command.args,
            vec![],
        );
        register(Some(payload)).expect("register should succeed");

        let response = run(Some(json!({
            "runtimeId": "runtime-process-failure",
            "commandId": "fail",
            "runId": "run-failed"
        })))
        .expect("run should return failed status payload")
        .expect("run should return payload");

        assert_eq!(response["status"], json!("failed"));
        assert_eq!(response["exitCode"], json!(7));
        assert_eq!(
            normalize_newlines(response["stderr"].as_str().unwrap_or_default()),
            "denied\n"
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn run_reports_timeout_status() {
        let root = temp_dir("run-timeout");
        let command = sleep_command(&root, 2);
        let mut payload = register_payload_with_command(
            &root,
            "runtime-timeout",
            "sleep",
            &command.executable,
            command.args,
            vec![],
        );
        payload["manifest"]["commands"][0]["timeoutMillis"] = json!(50);
        register(Some(payload)).expect("register should succeed");

        let response = run(Some(json!({
            "runtimeId": "runtime-timeout",
            "commandId": "sleep",
            "runId": "run-timeout"
        })))
        .expect("run should return timeout status payload")
        .expect("run should return payload");

        assert_eq!(response["status"], json!("timeout"));
    }

    #[cfg(unix)]
    #[test]
    fn run_does_not_hang_when_descendant_holds_stdout_open() {
        let root = temp_dir("run-descendant-stdout");
        let executable = root.join("hold-stdout.sh");
        write_executable(&executable, "#!/bin/sh\n(sleep 1 &)\nprintf 'done\\n'\n");
        let mut payload = register_payload_with_command(
            &root,
            "runtime-descendant-stdout",
            "hold-stdout",
            &executable,
            vec![],
            vec![],
        );
        payload["manifest"]["commands"][0]["timeoutMillis"] = json!(300);
        payload["manifest"]["policy"]["cleanup"]["killProcessTree"] = json!(false);
        register(Some(payload)).expect("register should succeed");

        let started_at = std::time::Instant::now();
        let result = run(Some(json!({
            "runtimeId": "runtime-descendant-stdout",
            "commandId": "hold-stdout",
            "runId": "run-descendant-stdout"
        })));

        assert!(
            started_at.elapsed() < std::time::Duration::from_secs(2),
            "run should be bounded by the command timeout"
        );
        match result {
            Err(error) => {
                assert_eq!(error.tag(), "Internal");
                assert!(
                    format!("{error:?}").contains("timed out reading local tool stdout"),
                    "unexpected error: {error:?}"
                );
            }
            Ok(Some(response)) => {
                assert_eq!(response["status"], json!("timeout"));
            }
            Ok(None) => panic!("run should return a payload or typed output timeout"),
        }
    }

    #[cfg(windows)]
    #[test]
    fn run_cleans_windows_job_descendants_without_breakaway_escape() {
        let root = temp_dir("run-windows-job-descendant");
        let marker = root.join("descendant-survived.txt");
        let powershell = windows_powershell();
        let child_script = format!(
            "Start-Sleep -Milliseconds 1500; Set-Content -LiteralPath '{}' -Value leaked",
            powershell_quote(marker.display().to_string().as_str())
        );
        let parent_script = format!(
            "Start-Process -FilePath '{}' -ArgumentList '-NoProfile','-NonInteractive','-Command','{}' -WindowStyle Hidden; Start-Sleep -Milliseconds 100",
            powershell_quote(powershell.display().to_string().as_str()),
            powershell_quote(child_script.as_str())
        );
        let payload = register_payload_with_command(
            &root,
            "runtime-windows-job-descendant",
            "spawn-descendant",
            &powershell,
            powershell_args(parent_script.as_str()),
            vec![],
        );
        register(Some(payload)).expect("register should succeed");

        let response = run(Some(json!({
            "runtimeId": "runtime-windows-job-descendant",
            "commandId": "spawn-descendant",
            "runId": "run-windows-job-descendant"
        })))
        .expect("run should succeed")
        .expect("run should return payload");

        assert_eq!(response["status"], json!("completed"));
        std::thread::sleep(std::time::Duration::from_millis(2500));
        assert!(
            !marker.exists(),
            "descendant escaped the Windows Job Object cleanup"
        );
    }

    #[test]
    fn register_rejects_remove_working_directory_until_host_owns_cleanup() {
        let root = temp_dir("register-remove-working-directory");
        let mut payload = valid_register_payload(&root, "runtime-remove-working-directory");
        payload["manifest"]["policy"]["cleanup"]["removeWorkingDirectory"] = json!(true);
        let error = register(Some(payload)).expect_err("unsafe cleanup should fail closed");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                "local-tool-runtime-remove-working-directory-unimplemented",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_projects_cwd_and_environment() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("run-cwd-env");
        let executable = root.join("print-env.sh");
        fs::write(
            &executable,
            "#!/bin/sh\nprintf '%s:' \"$LOCAL_TOOL_VALUE\"\npwd\n",
        )
        .expect("script should write");
        let mut permissions = fs::metadata(&executable)
            .expect("script metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).expect("script should be executable");
        let payload = register_payload_with_command(
            &root,
            "runtime-cwd-env",
            "print-env",
            &executable,
            vec![],
            vec![json!({ "name": "LOCAL_TOOL_VALUE", "value": "command-env" })],
        );
        register(Some(payload)).expect("register should succeed");

        let response = run(Some(json!({
            "runtimeId": "runtime-cwd-env",
            "commandId": "print-env"
        })))
        .expect("run should succeed")
        .expect("run should return payload");

        assert_eq!(response["status"], json!("completed"));
        let canonical_root = fs::canonicalize(&root)
            .expect("root should canonicalize")
            .display()
            .to_string();
        assert_eq!(
            response["stdout"].as_str().unwrap_or_default(),
            format!("command-env:{canonical_root}\n")
        );
    }

    #[test]
    fn register_rejects_command_cwd_that_escapes_policy_roots() {
        let root = temp_dir("register-cwd-root");
        let outside = temp_dir("register-cwd-outside");
        let mut payload = valid_register_payload(&root, "runtime-cwd-escape");
        payload["manifest"]["commands"][0]["cwd"] = json!(outside);

        let error = register(Some(payload)).expect_err("cwd escape should fail before spawn");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.commands.cwd",
                "must be within manifest cwd roots",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    #[test]
    fn stop_removes_registered_runtime() {
        let root = temp_dir("stop-runtime");
        register(Some(valid_register_payload(&root, "runtime-stop"))).expect("register");

        assert_eq!(
            stop(Some(json!({ "runtimeId": "runtime-stop" }))).expect("stop"),
            Some(json!({ "runtimeId": "runtime-stop", "stopped": true }))
        );
        assert!(matches!(
            run(Some(json!({
                "runtimeId": "runtime-stop",
                "commandId": "help"
            }))),
            Err(HostProtocolError::NotFound { .. })
        ));
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn stop_terminates_active_run() {
        let root = temp_dir("stop-active-run");
        let command = sleep_command(&root, 5);
        let payload = register_payload_with_command(
            &root,
            "runtime-stop-active-run",
            "sleep",
            &command.executable,
            command.args,
            vec![],
        );
        register(Some(payload)).expect("register should succeed");

        let run_thread = std::thread::spawn(|| {
            run(Some(json!({
                "runtimeId": "runtime-stop-active-run",
                "commandId": "sleep",
                "runId": "run-stop-active"
            })))
        });
        std::thread::sleep(std::time::Duration::from_millis(100));

        assert_eq!(
            stop(Some(json!({ "runtimeId": "runtime-stop-active-run" }))).expect("stop"),
            Some(json!({ "runtimeId": "runtime-stop-active-run", "stopped": true }))
        );
        let response = run_thread
            .join()
            .expect("run thread should not panic")
            .expect("terminated run should return status payload")
            .expect("run should return payload");
        assert_eq!(response["status"], json!("failed"));
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn run_rejects_duplicate_active_run_id() {
        let root = temp_dir("run-duplicate-active-id");
        let command = sleep_command(&root, 2);
        let payload = register_payload_with_command(
            &root,
            "runtime-duplicate-active-run",
            "sleep",
            &command.executable,
            command.args,
            vec![],
        );
        register(Some(payload)).expect("register should succeed");

        let run_thread = std::thread::spawn(|| {
            run(Some(json!({
                "runtimeId": "runtime-duplicate-active-run",
                "commandId": "sleep",
                "runId": "run-duplicate-active"
            })))
        });
        std::thread::sleep(std::time::Duration::from_millis(100));

        let error = run(Some(json!({
            "runtimeId": "runtime-duplicate-active-run",
            "commandId": "sleep",
            "runId": "run-duplicate-active"
        })))
        .expect_err("duplicate active run id should fail");

        assert_eq!(error.tag(), "AlreadyExists");
        stop(Some(json!({ "runtimeId": "runtime-duplicate-active-run" }))).expect("stop");
        run_thread
            .join()
            .expect("run thread should not panic")
            .expect("terminated run should return status payload");
    }

    #[test]
    fn health_runs_manifest_health_command() {
        let root = temp_dir("health-runtime");
        register(Some(valid_register_payload(&root, "runtime-health"))).expect("register");
        let response = health(Some(json!({ "runtimeId": "runtime-health" })))
            .expect("health")
            .expect("health payload");

        assert_eq!(response["runtimeId"], json!("runtime-health"));
        assert_eq!(response["status"], json!("healthy"));
    }

    #[test]
    fn register_rejects_malformed_semver_before_side_effects() {
        let root = temp_dir("invalid-semver");
        let mut payload = valid_register_payload(&root, "runtime-invalid");
        payload["manifest"]["version"] = json!("1.0.0-");
        let error = register(Some(payload)).expect_err("invalid SemVer must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.version",
                "must be SemVer",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    #[test]
    fn register_rejects_shell_metacharacters_before_side_effects() {
        let root = temp_dir("invalid-shell");
        let mut payload = valid_register_payload(&root, "runtime-invalid-shell");
        payload["manifest"]["commands"][0]["executable"] = json!("/usr/bin/node;rm");
        let error = register(Some(payload)).expect_err("invalid executable must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.commands.executable",
                "contains shell metacharacters",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    fn valid_register_payload(root: &Path, runtime_id: &str) -> serde_json::Value {
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "manifest": valid_manifest(root),
            "runtimeId": runtime_id,
            "traceId": "trace-local-tool-runtime"
        })
    }

    fn valid_manifest(root: &Path) -> serde_json::Value {
        let executable = env::current_exe()
            .expect("current test executable")
            .display()
            .to_string();
        let root = root.display().to_string();
        json!({
            "toolId": "tool-1",
            "name": "Tool One",
            "version": "1.0.0",
            "commands": [
                {
                    "commandId": "help",
                    "executable": executable,
                    "defaultArgs": ["--help"],
                    "cwd": root,
                    "timeoutMillis": 5000
                }
            ],
            "permissions": [
                {
                    "kind": "process.spawn",
                    "commands": [executable],
                    "cwd": [root],
                    "environment": "none",
                    "shell": false,
                    "audit": "always"
                }
            ],
            "policy": {
                "cwd": { "roots": [root] },
                "environment": { "variables": [] },
                "filesystem": { "readRoots": [root] },
                "network": { "hosts": [] },
                "budgets": {
                    "cpuMillis": UNBOUNDED_OS_BUDGET,
                    "memoryBytes": UNBOUNDED_OS_BUDGET,
                    "wallClockMillis": 5000,
                    "stdoutBytes": 65536,
                    "stderrBytes": 65536
                },
                "stdio": { "stdout": "capture", "stderr": "capture" },
                "cleanup": {
                    "killProcessTree": true,
                    "removeWorkingDirectory": false
                }
            },
            "health": {
                "commandId": "help",
                "intervalMillis": 10000,
                "timeoutMillis": 5000
            }
        })
    }

    fn register_payload_with_command(
        root: &Path,
        runtime_id: &str,
        command_id: &str,
        executable: &Path,
        default_args: Vec<serde_json::Value>,
        environment: Vec<serde_json::Value>,
    ) -> serde_json::Value {
        let executable = executable.display().to_string();
        let root = root.display().to_string();
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "manifest": {
                "toolId": "tool-1",
                "name": "Tool One",
                "version": "1.0.0",
                "commands": [
                    {
                        "commandId": command_id,
                        "executable": executable,
                        "defaultArgs": default_args,
                        "cwd": root,
                        "environment": environment,
                        "timeoutMillis": 5000
                    }
                ],
                "permissions": [
                    {
                        "kind": "process.spawn",
                        "commands": [executable],
                        "cwd": [root],
                        "environment": "allowlist",
                        "shell": false,
                        "audit": "always"
                    }
                ],
                "policy": {
                    "cwd": { "roots": [root] },
                    "environment": {
                        "variables": [{ "name": "LOCAL_TOOL_VALUE", "value": "manifest-env" }]
                    },
                    "filesystem": { "readRoots": [root] },
                    "network": { "hosts": [] },
                    "budgets": {
                        "cpuMillis": UNBOUNDED_OS_BUDGET,
                        "memoryBytes": UNBOUNDED_OS_BUDGET,
                        "wallClockMillis": 5000,
                        "stdoutBytes": 65536,
                        "stderrBytes": 65536
                    },
                    "stdio": { "stdout": "capture", "stderr": "capture" },
                    "cleanup": {
                        "killProcessTree": true,
                        "removeWorkingDirectory": false
                    }
                }
            },
            "runtimeId": runtime_id,
            "traceId": "trace-local-tool-runtime"
        })
    }

    struct TestCommand {
        executable: PathBuf,
        args: Vec<serde_json::Value>,
    }

    #[cfg(unix)]
    fn stderr_command(root: &Path) -> TestCommand {
        let executable = root.join("stderr.sh");
        write_executable(&executable, "#!/bin/sh\nprintf 'err\\n' >&2\n");
        TestCommand {
            executable,
            args: vec![],
        }
    }

    #[cfg(windows)]
    fn stderr_command(_root: &Path) -> TestCommand {
        TestCommand {
            executable: windows_cmd(),
            args: windows_cmd_args(">&2 echo err"),
        }
    }

    #[cfg(unix)]
    fn failure_command(root: &Path) -> TestCommand {
        let executable = root.join("fail.sh");
        write_executable(&executable, "#!/bin/sh\nprintf 'denied\\n' >&2\nexit 7\n");
        TestCommand {
            executable,
            args: vec![],
        }
    }

    #[cfg(windows)]
    fn failure_command(_root: &Path) -> TestCommand {
        TestCommand {
            executable: windows_cmd(),
            args: windows_cmd_args(">&2 echo denied & exit /B 7"),
        }
    }

    #[cfg(unix)]
    fn sleep_command(root: &Path, seconds: u64) -> TestCommand {
        let executable = root.join("sleep.sh");
        write_executable(&executable, &format!("#!/bin/sh\nsleep {seconds}\n"));
        TestCommand {
            executable,
            args: vec![],
        }
    }

    #[cfg(windows)]
    fn sleep_command(_root: &Path, seconds: u64) -> TestCommand {
        let ping_count = seconds.saturating_add(1).max(2);
        TestCommand {
            executable: windows_cmd(),
            args: windows_cmd_args(&format!("ping -n {ping_count} 127.0.0.1 >NUL")),
        }
    }

    #[cfg(windows)]
    fn windows_cmd() -> PathBuf {
        env::var_os("ComSpec")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let system_root = env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
                PathBuf::from(system_root).join("System32\\cmd.exe")
            })
    }

    #[cfg(windows)]
    fn windows_cmd_args(script: &str) -> Vec<serde_json::Value> {
        vec![json!("/D"), json!("/C"), json!(script)]
    }

    #[cfg(windows)]
    fn windows_powershell() -> PathBuf {
        let system_root = env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        PathBuf::from(system_root).join("System32\\WindowsPowerShell\\v1.0\\powershell.exe")
    }

    #[cfg(windows)]
    fn powershell_args(script: &str) -> Vec<serde_json::Value> {
        vec![
            json!("-NoProfile"),
            json!("-NonInteractive"),
            json!("-Command"),
            json!(script),
        ]
    }

    #[cfg(windows)]
    fn powershell_quote(value: &str) -> String {
        value.replace('\'', "''")
    }

    fn normalize_newlines(value: &str) -> String {
        value.replace("\r\n", "\n")
    }

    fn temp_dir(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("effect-desktop-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    #[cfg(unix)]
    fn write_executable(path: &Path, contents: &str) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(path, contents).expect("script should write");
        let mut permissions = fs::metadata(path).expect("script metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("script should be executable");
    }
}

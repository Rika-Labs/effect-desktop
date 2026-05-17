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
    collections::{HashMap, HashSet},
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
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
        child: Arc<Mutex<Child>>,
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
    ) -> Result<Option<Arc<Mutex<Child>>>, HostProtocolError> {
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
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        return encode_payload(
            LocalToolRuntimeSupportedPayload::unsupported(
                "local-tool-runtime-platform-unsupported",
            ),
            host_protocol::LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD,
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
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
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let _ = operation;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
    let mut child = Command::new(executable);
    child
        .args(command.default_args())
        .args(args)
        .current_dir(cwd)
        .env_clear();
    apply_environment(
        &mut child,
        session.manifest.policy().environment().variables(),
    );
    apply_environment(&mut child, command.environment());
    apply_stdio(&mut child, session.manifest.policy().stdio());
    platform::configure_command(&mut child);

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

        let mut child = match child.spawn() {
            Ok(child) => child,
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
        let guard = match platform::ChildGuard::attach(&child) {
            Ok(guard) => guard,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                remove_active_run(runtime_id, &run_id);
                if let Some(request_id) = request_id {
                    clear_active_run_request(request_id);
                }
                return Err(HostProtocolError::internal(
                    format!("failed to attach local tool process cleanup guard: {error}"),
                    operation,
                ));
            }
        };
        let stdout = capture_stream(
            child.stdout.take(),
            session.manifest.policy().budgets().stdout_bytes(),
        );
        let stderr = capture_stream(
            child.stderr.take(),
            session.manifest.policy().budgets().stderr_bytes(),
        );
        let child = Arc::new(Mutex::new(child));
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
        platform::release_child_guard(guard);
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
            platform::release_child_guard(guard);
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
        let child = lock_child(&child, operation)?;
        platform::cleanup_process_tree_after_exit(&child).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to clean local tool process tree: {error}"),
                operation,
            )
        })?;
    }
    platform::release_child_guard(guard);
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

fn apply_environment(
    command: &mut Command,
    entries: &[host_protocol::LocalToolRuntimeEnvironmentEntryPayload],
) {
    for entry in entries {
        command.env(entry.name(), entry.value());
    }
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

fn wait_until_deadline(
    child: &Arc<Mutex<Child>>,
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
    child: &Arc<Mutex<Child>>,
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
        platform::request_termination(&mut locked_child).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to request local tool termination: {error}"),
                operation,
            )
        })?;
        drop(locked_child);
        if wait_for_child_exit(child, Instant::now() + TERMINATION_GRACE, operation)?.is_none() {
            let mut locked_child = lock_child(child, operation)?;
            platform::force_termination(&mut locked_child).map_err(|error| {
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
    child: &Arc<Mutex<Child>>,
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
    child: &'a Arc<Mutex<Child>>,
    operation: &'static str,
) -> Result<std::sync::MutexGuard<'a, Child>, HostProtocolError> {
    child
        .lock()
        .map_err(|_| HostProtocolError::internal("local tool child lock poisoned", operation))
}

fn capture_stream(
    stream: Option<impl Read + Send + 'static>,
    limit: u64,
) -> Option<CapturedStream> {
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

    #[cfg(unix)]
    #[test]
    fn run_enforces_stderr_budget() {
        let root = temp_dir("run-stderr-limit");
        let executable = root.join("stderr.sh");
        write_executable(&executable, "#!/bin/sh\nprintf 'err\\n' >&2\n");
        let mut payload = register_payload_with_command(
            &root,
            "runtime-stderr-limit",
            "stderr",
            &executable,
            vec![],
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

    #[cfg(unix)]
    #[test]
    fn run_reports_process_failure_and_captures_stderr() {
        let root = temp_dir("run-process-failure");
        let executable = root.join("fail.sh");
        write_executable(&executable, "#!/bin/sh\nprintf 'denied\\n' >&2\nexit 7\n");
        let payload = register_payload_with_command(
            &root,
            "runtime-process-failure",
            "fail",
            &executable,
            vec![],
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
        assert_eq!(response["stderr"], json!("denied\n"));
    }

    #[cfg(unix)]
    #[test]
    fn run_reports_timeout_status() {
        let root = temp_dir("run-timeout");
        let executable = root.join("sleep.sh");
        write_executable(&executable, "#!/bin/sh\nsleep 1\n");
        let mut payload = register_payload_with_command(
            &root,
            "runtime-timeout",
            "sleep",
            &executable,
            vec![],
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

    #[cfg(unix)]
    #[test]
    fn stop_terminates_active_run() {
        let root = temp_dir("stop-active-run");
        let executable = root.join("sleep.sh");
        write_executable(&executable, "#!/bin/sh\nsleep 5\n");
        let payload = register_payload_with_command(
            &root,
            "runtime-stop-active-run",
            "sleep",
            &executable,
            vec![],
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

    #[cfg(unix)]
    #[test]
    fn run_rejects_duplicate_active_run_id() {
        let root = temp_dir("run-duplicate-active-id");
        let executable = root.join("sleep.sh");
        write_executable(&executable, "#!/bin/sh\nsleep 1\n");
        let payload = register_payload_with_command(
            &root,
            "runtime-duplicate-active-run",
            "sleep",
            &executable,
            vec![],
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

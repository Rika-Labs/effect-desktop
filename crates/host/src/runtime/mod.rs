//! Runtime child-process supervision.

mod platform;

use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{
    env::VarError,
    ffi::OsString,
    io::{self, BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, ExitStatus, Stdio},
    sync::mpsc::{self, Receiver, RecvTimeoutError, Sender},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tracing::{debug, error, warn};

const RUNTIME_READY_EVENT: &str = "runtime.ready";
const RUNTIME_PROFILE_ENV: &str = "EFFECT_DESKTOP_PROFILE";
const DEFAULT_RESTART_READY_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_DEV_RESTARTS: usize = 3;
const TERMINATION_GRACE: Duration = Duration::from_secs(5);
const TERMINATION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MONITOR_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeConfig {
    executable: PathBuf,
    args: Vec<OsString>,
    cwd: Option<PathBuf>,
}

impl RuntimeConfig {
    pub(crate) fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            args: Vec::new(),
            cwd: None,
        }
    }

    pub(crate) fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    pub(crate) fn cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.executable);
        command
            .args(&self.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(cwd) = &self.cwd {
            command.current_dir(cwd);
        }

        command
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeReady {
    version: String,
}

impl RuntimeReady {
    pub(crate) fn version(&self) -> &str {
        &self.version
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RuntimeProfile {
    Dev,
    Prod,
}

impl RuntimeProfile {
    pub(crate) fn from_env() -> Result<Self> {
        match std::env::var(RUNTIME_PROFILE_ENV) {
            Ok(value) => Self::from_env_value(Some(&value)),
            Err(VarError::NotPresent) => Self::from_env_value(None),
            Err(VarError::NotUnicode(value)) => {
                bail!("invalid {RUNTIME_PROFILE_ENV} non-Unicode value {value:?}")
            }
        }
    }

    fn from_env_value(value: Option<&str>) -> Result<Self> {
        match value {
            Some("dev") => Ok(Self::Dev),
            Some("prod") => Ok(Self::Prod),
            Some(value) => {
                bail!("invalid {RUNTIME_PROFILE_ENV} value {value:?}; expected \"dev\" or \"prod\"")
            }
            None => Ok(Self::default_for_build()),
        }
    }

    fn default_for_build() -> Self {
        if cfg!(debug_assertions) {
            Self::Dev
        } else {
            Self::Prod
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Prod => "prod",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RestartPolicy {
    profile: RuntimeProfile,
    max_dev_restarts: usize,
    ready_timeout: Duration,
}

impl RestartPolicy {
    pub(crate) fn for_profile(profile: RuntimeProfile) -> Self {
        Self {
            profile,
            max_dev_restarts: DEFAULT_DEV_RESTARTS,
            ready_timeout: DEFAULT_RESTART_READY_TIMEOUT,
        }
    }

    fn should_restart(self, completed_restarts: usize) -> bool {
        self.profile == RuntimeProfile::Dev && completed_restarts < self.max_dev_restarts
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RuntimeStream {
    Stdout,
    Stderr,
}

#[derive(Debug)]
pub(crate) enum RuntimeEvent {
    Started {
        pid: u32,
    },
    Stdout {
        line: String,
    },
    Stderr {
        line: String,
    },
    StdioError {
        stream: RuntimeStream,
        error: String,
    },
    LifecycleError {
        error: String,
    },
    Exited {
        status: ExitStatus,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Termination {
    Terminate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MonitorCommand {
    Shutdown,
}

struct RuntimeChild {
    events: Receiver<RuntimeEvent>,
    terminate: Sender<Termination>,
    lifecycle_thread: JoinHandle<()>,
}

pub(crate) struct Supervisor {
    config: RuntimeConfig,
    policy: RestartPolicy,
    child: Option<RuntimeChild>,
    monitor_shutdown: Option<Sender<MonitorCommand>>,
    monitor_thread: Option<JoinHandle<()>>,
}

impl Supervisor {
    pub(crate) fn spawn(config: RuntimeConfig, policy: RestartPolicy) -> Result<Self> {
        let child = spawn_runtime_child(&config)?;

        Ok(Self {
            config,
            policy,
            child: Some(child),
            monitor_shutdown: None,
            monitor_thread: None,
        })
    }

    pub(crate) fn events(&self) -> &Receiver<RuntimeEvent> {
        &self
            .child
            .as_ref()
            .expect("runtime child moved into post-ready monitor")
            .events
    }

    fn start_post_ready_monitor(&mut self) -> Result<()> {
        let child = self
            .child
            .take()
            .context("runtime child already moved into post-ready monitor")?;
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        self.monitor_shutdown = Some(shutdown_tx);
        self.monitor_thread = Some(spawn_runtime_monitor(
            self.config.clone(),
            self.policy,
            child,
            shutdown_rx,
        ));
        Ok(())
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        if let Some(shutdown) = self.monitor_shutdown.take() {
            let _ = shutdown.send(MonitorCommand::Shutdown);
        }
        join_thread(self.monitor_thread.take());

        if let Some(child) = self.child.take() {
            terminate_runtime_child(child);
        }
    }
}

pub(crate) fn await_ready(supervisor: &mut Supervisor, timeout: Duration) -> Result<RuntimeReady> {
    let ready = await_ready_events(supervisor.events(), timeout)?;
    supervisor.start_post_ready_monitor()?;
    Ok(ready)
}

fn await_ready_events(events: &Receiver<RuntimeEvent>, timeout: Duration) -> Result<RuntimeReady> {
    let deadline = Instant::now() + timeout;
    let mut last_stdout_line = None;

    loop {
        let now = Instant::now();
        if now >= deadline {
            return timeout_error(timeout, last_stdout_line.as_deref());
        }

        match events.recv_timeout(deadline.saturating_duration_since(now)) {
            Ok(RuntimeEvent::Started { pid }) => {
                debug!(pid, "runtime child started");
            }
            Ok(RuntimeEvent::Stdout { line }) => {
                last_stdout_line = Some(line.clone());

                if let Some(ready) = parse_runtime_ready_line(&line)? {
                    return Ok(ready);
                }

                debug!(line, "runtime stdout before ready");
            }
            Ok(RuntimeEvent::Stderr { line }) => {
                warn!(line, "runtime stderr before ready");
            }
            Ok(RuntimeEvent::StdioError { stream, error }) => {
                bail!("failed to read runtime {stream:?} before {RUNTIME_READY_EVENT}: {error}");
            }
            Ok(RuntimeEvent::LifecycleError { error }) => {
                bail!("runtime lifecycle failed before {RUNTIME_READY_EVENT}: {error}");
            }
            Ok(RuntimeEvent::Exited { status }) => {
                bail!("runtime exited before {RUNTIME_READY_EVENT}: {status}");
            }
            Err(RecvTimeoutError::Timeout) => {
                return timeout_error(timeout, last_stdout_line.as_deref());
            }
            Err(RecvTimeoutError::Disconnected) => {
                bail!("runtime event channel closed before {RUNTIME_READY_EVENT}");
            }
        }
    }
}

fn parse_runtime_ready_line(line: &str) -> Result<Option<RuntimeReady>> {
    let value = match serde_json::from_str::<Value>(line) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    if value.get("event").and_then(Value::as_str) != Some(RUNTIME_READY_EVENT) {
        return Ok(None);
    }

    let version = value
        .get("version")
        .and_then(Value::as_str)
        .with_context(|| format!("{RUNTIME_READY_EVENT} line missing string version: {line}"))?;

    Ok(Some(RuntimeReady {
        version: version.to_string(),
    }))
}

fn timeout_error(timeout: Duration, last_stdout_line: Option<&str>) -> Result<RuntimeReady> {
    match last_stdout_line {
        Some(line) => bail!(
            "timed out waiting for {RUNTIME_READY_EVENT} after {timeout:?}; last runtime stdout line: {line}"
        ),
        None => bail!("timed out waiting for {RUNTIME_READY_EVENT} after {timeout:?}"),
    }
}

fn spawn_runtime_child(config: &RuntimeConfig) -> Result<RuntimeChild> {
    let mut command = config.command();
    platform::configure_command(&mut command);

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to spawn runtime executable {:?}", config.executable))?;
    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .context("failed to capture runtime stdout")?;
    let stderr = child
        .stderr
        .take()
        .context("failed to capture runtime stderr")?;
    let platform_guard = match platform::ChildGuard::attach(&child) {
        Ok(guard) => guard,
        Err(error) => {
            terminate_after_failed_platform_setup(&mut child);
            return Err(error).context("failed to attach runtime child cleanup guard");
        }
    };

    let (event_tx, events) = mpsc::channel();
    let (terminate, terminate_rx) = mpsc::channel();

    event_tx
        .send(RuntimeEvent::Started { pid })
        .context("failed to emit runtime started event")?;

    let stdout_thread = spawn_reader(RuntimeStream::Stdout, stdout, event_tx.clone());
    let stderr_thread = spawn_reader(RuntimeStream::Stderr, stderr, event_tx.clone());
    let lifecycle_thread = spawn_lifecycle(
        child,
        platform_guard,
        terminate_rx,
        event_tx,
        stdout_thread,
        stderr_thread,
    );

    Ok(RuntimeChild {
        events,
        terminate,
        lifecycle_thread,
    })
}

fn spawn_runtime_monitor(
    config: RuntimeConfig,
    policy: RestartPolicy,
    child: RuntimeChild,
    shutdown: Receiver<MonitorCommand>,
) -> JoinHandle<()> {
    thread::spawn(move || monitor_runtime(config, policy, child, shutdown))
}

fn monitor_runtime(
    config: RuntimeConfig,
    policy: RestartPolicy,
    mut child: RuntimeChild,
    shutdown: Receiver<MonitorCommand>,
) {
    let mut completed_restarts = 0;

    loop {
        match next_monitor_event(&child.events, &shutdown) {
            MonitorNext::Event(RuntimeEvent::Started { pid }) => {
                debug!(pid, "runtime child started");
            }
            MonitorNext::Event(RuntimeEvent::Stdout { line }) => {
                debug!(line, "runtime stdout");
            }
            MonitorNext::Event(RuntimeEvent::Stderr { line }) => {
                warn!(line, "runtime stderr");
            }
            MonitorNext::Event(RuntimeEvent::StdioError { stream, error }) => {
                warn!(?stream, error, "runtime stdio error");
                terminate_runtime_child(child);
                break;
            }
            MonitorNext::Event(RuntimeEvent::LifecycleError { error }) => {
                error!(error, "runtime lifecycle failed");
                finish_runtime_child(child);
                break;
            }
            MonitorNext::Event(RuntimeEvent::Exited { status }) => {
                finish_runtime_child(child);

                if status.success() {
                    debug!(%status, "runtime exited cleanly");
                    break;
                }

                if !policy.should_restart(completed_restarts) {
                    error!(
                        %status,
                        profile = policy.profile.as_str(),
                        completed_restarts,
                        max_restarts = policy.max_dev_restarts,
                        "runtime crashed; not restarting"
                    );
                    break;
                }

                completed_restarts += 1;
                warn!(
                    %status,
                    completed_restarts,
                    max_restarts = policy.max_dev_restarts,
                    "runtime crashed; restarting in dev profile"
                );

                child = match spawn_runtime_child(&config) {
                    Ok(child) => child,
                    Err(error) => {
                        error!(%error, "failed to restart runtime after crash");
                        break;
                    }
                };

                match await_ready_events_or_shutdown(&child.events, policy.ready_timeout, &shutdown)
                {
                    ReadyWait::Ready(Ok(ready)) => {
                        warn!(
                            version = ready.version(),
                            completed_restarts, "runtime restarted and became ready"
                        );
                    }
                    ReadyWait::Ready(Err(error)) => {
                        error!(%error, "restarted runtime failed before ready");
                        terminate_runtime_child(child);
                        break;
                    }
                    ReadyWait::Shutdown => {
                        terminate_runtime_child(child);
                        break;
                    }
                }
            }
            MonitorNext::Shutdown => {
                terminate_runtime_child(child);
                break;
            }
            MonitorNext::Disconnected => {
                finish_runtime_child(child);
                break;
            }
        }
    }
}

enum MonitorNext {
    Event(RuntimeEvent),
    Shutdown,
    Disconnected,
}

fn next_monitor_event(
    events: &Receiver<RuntimeEvent>,
    shutdown: &Receiver<MonitorCommand>,
) -> MonitorNext {
    loop {
        if matches!(shutdown.try_recv(), Ok(MonitorCommand::Shutdown)) {
            return MonitorNext::Shutdown;
        }

        match events.recv_timeout(MONITOR_POLL_INTERVAL) {
            Ok(event) => return MonitorNext::Event(event),
            Err(RecvTimeoutError::Timeout) => {
                if matches!(shutdown.try_recv(), Ok(MonitorCommand::Shutdown)) {
                    return MonitorNext::Shutdown;
                }
            }
            Err(RecvTimeoutError::Disconnected) => return MonitorNext::Disconnected,
        }
    }
}

enum ReadyWait {
    Ready(Result<RuntimeReady>),
    Shutdown,
}

fn await_ready_events_or_shutdown(
    events: &Receiver<RuntimeEvent>,
    timeout: Duration,
    shutdown: &Receiver<MonitorCommand>,
) -> ReadyWait {
    let deadline = Instant::now() + timeout;
    let mut last_stdout_line = None;

    loop {
        if matches!(shutdown.try_recv(), Ok(MonitorCommand::Shutdown)) {
            return ReadyWait::Shutdown;
        }

        let now = Instant::now();
        if now >= deadline {
            return ReadyWait::Ready(timeout_error(timeout, last_stdout_line.as_deref()));
        }

        match events.recv_timeout(
            deadline
                .saturating_duration_since(now)
                .min(MONITOR_POLL_INTERVAL),
        ) {
            Ok(RuntimeEvent::Started { pid }) => {
                debug!(pid, "runtime child started");
            }
            Ok(RuntimeEvent::Stdout { line }) => {
                last_stdout_line = Some(line.clone());

                match parse_runtime_ready_line(&line) {
                    Ok(Some(ready)) => return ReadyWait::Ready(Ok(ready)),
                    Ok(None) => debug!(line, "runtime stdout before ready"),
                    Err(error) => return ReadyWait::Ready(Err(error)),
                }
            }
            Ok(RuntimeEvent::Stderr { line }) => {
                warn!(line, "runtime stderr before ready");
            }
            Ok(RuntimeEvent::StdioError { stream, error }) => {
                return ReadyWait::Ready(Err(anyhow::anyhow!(
                    "failed to read runtime {stream:?} before {RUNTIME_READY_EVENT}: {error}"
                )));
            }
            Ok(RuntimeEvent::LifecycleError { error }) => {
                return ReadyWait::Ready(Err(anyhow::anyhow!(
                    "runtime lifecycle failed before {RUNTIME_READY_EVENT}: {error}"
                )));
            }
            Ok(RuntimeEvent::Exited { status }) => {
                return ReadyWait::Ready(Err(anyhow::anyhow!(
                    "runtime exited before {RUNTIME_READY_EVENT}: {status}"
                )));
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                return ReadyWait::Ready(Err(anyhow::anyhow!(
                    "runtime event channel closed before {RUNTIME_READY_EVENT}"
                )));
            }
        }
    }
}

fn terminate_runtime_child(child: RuntimeChild) {
    let _ = child.terminate.send(Termination::Terminate);
    finish_runtime_child(child);
}

fn finish_runtime_child(child: RuntimeChild) {
    let _events = child.events;
    join_thread(Some(child.lifecycle_thread));
}

fn spawn_reader<R>(stream: RuntimeStream, reader: R, events: Sender<RuntimeEvent>) -> JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(reader);

        for line in reader.lines() {
            let event = match line {
                Ok(line) => match stream {
                    RuntimeStream::Stdout => RuntimeEvent::Stdout { line },
                    RuntimeStream::Stderr => RuntimeEvent::Stderr { line },
                },
                Err(error) => RuntimeEvent::StdioError {
                    stream,
                    error: error.to_string(),
                },
            };

            if events.send(event).is_err() {
                break;
            }
        }
    })
}

fn spawn_lifecycle(
    mut child: Child,
    platform_guard: platform::ChildGuard,
    termination: Receiver<Termination>,
    events: Sender<RuntimeEvent>,
    stdout_thread: JoinHandle<()>,
    stderr_thread: JoinHandle<()>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let wait_result = wait_for_exit_or_termination(&mut child, &termination);
        let cleanup_result = platform::cleanup_process_tree_after_exit(&child);
        platform::release_child_guard(platform_guard);
        let stdout_joined = join_thread(Some(stdout_thread));
        let stderr_joined = join_thread(Some(stderr_thread));

        let event = match (wait_result, cleanup_result, stdout_joined, stderr_joined) {
            (Ok(status), Ok(()), true, true) => RuntimeEvent::Exited { status },
            (Err(error), _, _, _) => RuntimeEvent::LifecycleError {
                error: error.to_string(),
            },
            (_, Err(error), _, _) => RuntimeEvent::LifecycleError {
                error: format!("failed to clean runtime process tree: {error}"),
            },
            (_, _, false, _) => RuntimeEvent::LifecycleError {
                error: "runtime stdout reader thread panicked".to_string(),
            },
            (_, _, _, false) => RuntimeEvent::LifecycleError {
                error: "runtime stderr reader thread panicked".to_string(),
            },
        };

        let _ = events.send(event);
    })
}

fn wait_for_exit_or_termination(
    child: &mut Child,
    termination: &Receiver<Termination>,
) -> io::Result<ExitStatus> {
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }

        match termination.recv_timeout(TERMINATION_POLL_INTERVAL) {
            Ok(Termination::Terminate) | Err(RecvTimeoutError::Disconnected) => {
                return terminate_child(child);
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

fn terminate_child(child: &mut Child) -> io::Result<ExitStatus> {
    platform::request_termination(child)?;

    let deadline = Instant::now() + TERMINATION_GRACE;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }

        if Instant::now() >= deadline {
            platform::force_termination(child)?;
            return child.wait();
        }

        thread::sleep(TERMINATION_POLL_INTERVAL);
    }
}

fn terminate_after_failed_platform_setup(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn join_thread(thread: Option<JoinHandle<()>>) -> bool {
    if let Some(thread) = thread {
        return thread.join().is_ok();
    }

    true
}

#[cfg(test)]
mod tests {
    use super::{
        await_ready, await_ready_events, monitor_runtime, parse_runtime_ready_line, RestartPolicy,
        RuntimeChild, RuntimeConfig, RuntimeEvent, RuntimeProfile, RuntimeReady, RuntimeStream,
        Supervisor, Termination,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::mpsc::{self, Receiver},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    const EVENT_TIMEOUT: Duration = Duration::from_secs(5);

    #[test]
    fn supervisor_emits_started_stdio_and_exit_events() {
        let supervisor = Supervisor::spawn(
            RuntimeConfig::new("bun").args([
                "-e",
                "console.log('runtime stdout'); console.error('runtime stderr');",
            ]),
            test_policy(RuntimeProfile::Prod, 0, EVENT_TIMEOUT),
        )
        .expect("runtime child should spawn");

        let events = collect_until_exit(supervisor.events());

        assert!(
            events
                .iter()
                .any(|event| matches!(event, RuntimeEvent::Started { pid } if *pid > 0)),
            "events did not include Started: {events:?}"
        );
        assert!(
            events.iter().any(
                |event| matches!(event, RuntimeEvent::Stdout { line } if line == "runtime stdout")
            ),
            "events did not include stdout line: {events:?}"
        );
        assert!(
            events.iter().any(
                |event| matches!(event, RuntimeEvent::Stderr { line } if line == "runtime stderr")
            ),
            "events did not include stderr line: {events:?}"
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(event, RuntimeEvent::Exited { status } if status.success())),
            "events did not include successful exit: {events:?}"
        );
        assert_terminal_event_closes_channel(&supervisor);
    }

    #[test]
    fn supervisor_closes_inherited_stdio_before_exited() {
        let supervisor = Supervisor::spawn(RuntimeConfig::new("bun").args([
            "-e",
            "Bun.spawn(['bun', '-e', 'setInterval(() => {}, 1000)'], { stdout: 'inherit', stderr: 'inherit' }); console.log('parent done'); process.exit(0);",
        ]), test_policy(RuntimeProfile::Prod, 0, EVENT_TIMEOUT))
        .expect("runtime child should spawn");

        let events = collect_until_exit(supervisor.events());

        assert!(
            events.iter().any(
                |event| matches!(event, RuntimeEvent::Stdout { line } if line == "parent done")
            ),
            "events did not include parent stdout line: {events:?}"
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(event, RuntimeEvent::Exited { status } if status.success())),
            "events did not include successful exit: {events:?}"
        );
        assert_terminal_event_closes_channel(&supervisor);
    }

    #[test]
    fn dropping_supervisor_terminates_long_running_child() {
        let supervisor = Supervisor::spawn(
            RuntimeConfig::new("bun").args(["-e", "setInterval(() => {}, 1000);"]),
            test_policy(RuntimeProfile::Prod, 0, EVENT_TIMEOUT),
        )
        .expect("runtime child should spawn");

        let started = supervisor
            .events()
            .recv_timeout(EVENT_TIMEOUT)
            .expect("runtime should start");
        assert!(
            matches!(started, RuntimeEvent::Started { pid } if pid > 0),
            "first event should be Started: {started:?}"
        );

        drop(supervisor);
    }

    #[test]
    fn runtime_event_models_stdio_errors_explicitly() {
        let event = RuntimeEvent::StdioError {
            stream: RuntimeStream::Stdout,
            error: "broken pipe".to_string(),
        };

        assert!(matches!(
            event,
            RuntimeEvent::StdioError {
                stream: RuntimeStream::Stdout,
                ..
            }
        ));
    }

    #[test]
    fn monitor_terminates_child_on_stdio_error() {
        let (events_tx, events_rx) = mpsc::channel();
        let (child, terminated_rx) = child_that_reports_termination(events_rx);
        let (_shutdown_tx, shutdown_rx) = mpsc::channel();

        events_tx
            .send(RuntimeEvent::StdioError {
                stream: RuntimeStream::Stdout,
                error: "decode failed".to_string(),
            })
            .expect("stdio error should send");
        drop(events_tx);

        monitor_runtime(
            RuntimeConfig::new("unused"),
            test_policy(RuntimeProfile::Prod, 0, EVENT_TIMEOUT),
            child,
            shutdown_rx,
        );

        assert!(
            terminated_rx
                .recv_timeout(EVENT_TIMEOUT)
                .expect("termination observation should send"),
            "monitor must terminate a child after stdio failure"
        );
    }

    #[test]
    fn runtime_profile_accepts_only_dev_or_prod() {
        assert_eq!(
            RuntimeProfile::from_env_value(Some("dev")).expect("dev profile should parse"),
            RuntimeProfile::Dev
        );
        assert_eq!(
            RuntimeProfile::from_env_value(Some("prod")).expect("prod profile should parse"),
            RuntimeProfile::Prod
        );

        let error = RuntimeProfile::from_env_value(Some("staging"))
            .expect_err("unknown profile should fail");

        assert_eq!(
            error.to_string(),
            r#"invalid EFFECT_DESKTOP_PROFILE value "staging"; expected "dev" or "prod""#
        );
    }

    #[test]
    fn runtime_profile_defaults_to_build_profile() {
        assert_eq!(
            RuntimeProfile::from_env_value(None).expect("default profile should resolve"),
            RuntimeProfile::default_for_build()
        );
    }

    #[test]
    fn restart_policy_restarts_dev_only_until_cap() {
        let dev_policy = test_policy(RuntimeProfile::Dev, 1, EVENT_TIMEOUT);
        let prod_policy = test_policy(RuntimeProfile::Prod, 1, EVENT_TIMEOUT);

        assert!(dev_policy.should_restart(0));
        assert!(!dev_policy.should_restart(1));
        assert!(!prod_policy.should_restart(0));
    }

    #[test]
    fn runtime_ready_line_returns_version() {
        let ready = parse_runtime_ready_line(r#"{"event":"runtime.ready","version":"0.0.0"}"#)
            .expect("ready line should parse");

        assert_eq!(
            ready,
            Some(RuntimeReady {
                version: "0.0.0".to_string()
            })
        );
    }

    #[test]
    fn runtime_ready_line_ignores_non_ready_output() {
        assert_eq!(
            parse_runtime_ready_line("runtime log line").expect("plain log line should not fail"),
            None
        );
        assert_eq!(
            parse_runtime_ready_line(r#"{"event":"runtime.other","version":"0.0.0"}"#)
                .expect("non-ready JSON should not fail"),
            None
        );
    }

    #[test]
    fn runtime_ready_line_requires_string_version() {
        let error = parse_runtime_ready_line(r#"{"event":"runtime.ready"}"#)
            .expect_err("ready line without version should fail");

        assert_eq!(
            error.to_string(),
            r#"runtime.ready line missing string version: {"event":"runtime.ready"}"#
        );
    }

    #[test]
    fn await_ready_events_resolves_after_started_and_noise() {
        let (events_tx, events_rx) = mpsc::channel();
        events_tx
            .send(RuntimeEvent::Started { pid: 1 })
            .expect("started event should send");
        events_tx
            .send(RuntimeEvent::Stdout {
                line: "booting".to_string(),
            })
            .expect("stdout event should send");
        events_tx
            .send(RuntimeEvent::Stdout {
                line: r#"{"event":"runtime.ready","version":"0.0.0"}"#.to_string(),
            })
            .expect("ready event should send");

        let ready =
            await_ready_events(&events_rx, EVENT_TIMEOUT).expect("ready event should resolve");

        assert_eq!(ready.version(), "0.0.0");
    }

    #[test]
    fn await_ready_events_fails_on_lifecycle_error_before_ready() {
        let (events_tx, events_rx) = mpsc::channel();
        events_tx
            .send(RuntimeEvent::LifecycleError {
                error: "spawn failed".to_string(),
            })
            .expect("lifecycle error event should send");

        let error = await_ready_events(&events_rx, EVENT_TIMEOUT)
            .expect_err("lifecycle error should fail readiness");

        assert_eq!(
            error.to_string(),
            "runtime lifecycle failed before runtime.ready: spawn failed"
        );
    }

    #[test]
    fn await_ready_events_times_out_without_ready() {
        let (_events_tx, events_rx) = mpsc::channel();

        let error = await_ready_events(&events_rx, Duration::from_millis(1))
            .expect_err("missing ready event should time out");

        assert_eq!(
            error.to_string(),
            "timed out waiting for runtime.ready after 1ms"
        );
    }

    #[test]
    fn dev_policy_restarts_nonzero_exit_after_ready() {
        let restart_count_path = temp_count_path("dev-restart");
        let _ = fs::remove_file(&restart_count_path);
        let mut supervisor = Supervisor::spawn(
            crash_once_runtime_config(&restart_count_path),
            test_policy(RuntimeProfile::Dev, 1, EVENT_TIMEOUT),
        )
        .expect("runtime child should spawn");

        await_ready(&mut supervisor, EVENT_TIMEOUT).expect("initial runtime should become ready");

        wait_for_count(&restart_count_path, 2);

        drop(supervisor);
        let _ = fs::remove_file(restart_count_path);
    }

    #[test]
    fn dev_policy_terminates_restart_that_never_becomes_ready() {
        let restart_count_path = temp_count_path("dev-restart-no-ready");
        let _ = fs::remove_file(&restart_count_path);
        let mut supervisor = Supervisor::spawn(
            restart_without_ready_runtime_config(&restart_count_path),
            test_policy(RuntimeProfile::Dev, 1, Duration::from_secs(1)),
        )
        .expect("runtime child should spawn");

        await_ready(&mut supervisor, EVENT_TIMEOUT).expect("initial runtime should become ready");
        wait_for_count(&restart_count_path, 2);
        thread::sleep(Duration::from_millis(1_800));
        drop(supervisor);

        let final_count =
            fs::read_to_string(&restart_count_path).expect("restart count should be written");
        assert_ne!(
            final_count, "survived",
            "failed restart generation must be terminated after ready timeout"
        );

        let _ = fs::remove_file(restart_count_path);
    }

    #[test]
    fn prod_policy_does_not_restart_nonzero_exit_after_ready() {
        let restart_count_path = temp_count_path("prod-no-restart");
        let _ = fs::remove_file(&restart_count_path);
        let mut supervisor = Supervisor::spawn(
            crash_once_runtime_config(&restart_count_path),
            test_policy(RuntimeProfile::Prod, 1, EVENT_TIMEOUT),
        )
        .expect("runtime child should spawn");

        await_ready(&mut supervisor, EVENT_TIMEOUT).expect("runtime should become ready");
        thread::sleep(Duration::from_millis(500));

        assert_eq!(
            read_count(&restart_count_path),
            1,
            "prod profile must not restart a crashed runtime"
        );

        drop(supervisor);
        let _ = fs::remove_file(restart_count_path);
    }

    fn collect_until_exit(events: &Receiver<RuntimeEvent>) -> Vec<RuntimeEvent> {
        let deadline = Instant::now() + EVENT_TIMEOUT;
        let mut collected = Vec::new();

        loop {
            let now = Instant::now();
            assert!(
                now < deadline,
                "timed out waiting for runtime exit event: {collected:?}"
            );

            let remaining = deadline.saturating_duration_since(now);
            let event = match events.recv_timeout(remaining.min(Duration::from_millis(100))) {
                Ok(event) => event,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    panic!("runtime event channel closed before exit: {collected:?}");
                }
            };
            let exited = matches!(event, RuntimeEvent::Exited { .. });
            collected.push(event);

            if exited {
                return collected;
            }
        }
    }

    fn assert_terminal_event_closes_channel(supervisor: &Supervisor) {
        let after_exit = supervisor.events().recv_timeout(Duration::from_millis(50));

        assert!(
            matches!(
                after_exit,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected)
            ),
            "runtime emitted or retained events after Exited: {after_exit:?}"
        );
    }

    fn child_that_reports_termination(
        events: Receiver<RuntimeEvent>,
    ) -> (RuntimeChild, Receiver<bool>) {
        let (terminate_tx, terminate_rx) = mpsc::channel();
        let (terminated_tx, terminated_rx) = mpsc::channel();
        let lifecycle_thread = thread::spawn(move || {
            let terminated = matches!(
                terminate_rx.recv_timeout(Duration::from_millis(100)),
                Ok(Termination::Terminate)
            );
            terminated_tx
                .send(terminated)
                .expect("termination observation should send");
        });

        (
            RuntimeChild {
                events,
                terminate: terminate_tx,
                lifecycle_thread,
            },
            terminated_rx,
        )
    }

    fn test_policy(
        profile: RuntimeProfile,
        max_dev_restarts: usize,
        ready_timeout: Duration,
    ) -> RestartPolicy {
        RestartPolicy {
            profile,
            max_dev_restarts,
            ready_timeout,
        }
    }

    fn crash_once_runtime_config(count_path: &Path) -> RuntimeConfig {
        let count_path_json =
            serde_json::to_string(count_path.to_str().expect("temp path should be UTF-8"))
                .expect("temp path should encode as JSON");
        let script = format!(
            r#"
const path = {count_path_json};
let count = 0;
try {{
  count = Number(await Bun.file(path).text()) || 0;
}} catch {{
}}
await Bun.write(path, String(count + 1));
console.log(JSON.stringify({{ event: "runtime.ready", version: "test" }}));
if (count === 0) process.exit(1);
setInterval(() => {{}}, 1000);
"#
        );

        RuntimeConfig::new("bun").args(["-e".to_string(), script])
    }

    fn restart_without_ready_runtime_config(count_path: &Path) -> RuntimeConfig {
        let count_path_json =
            serde_json::to_string(count_path.to_str().expect("temp path should be UTF-8"))
                .expect("temp path should encode as JSON");
        let script = format!(
            r#"
const path = {count_path_json};
let count = 0;
try {{
  count = Number(await Bun.file(path).text()) || 0;
}} catch {{
}}
await Bun.write(path, String(count + 1));
if (count === 0) {{
  console.log(JSON.stringify({{ event: "runtime.ready", version: "test" }}));
  process.exit(1);
}}
setTimeout(async () => {{
  await Bun.write(path, "survived");
  process.exit(0);
}}, 1600);
setInterval(() => {{}}, 1000);
"#
        );

        RuntimeConfig::new("bun").args(["-e".to_string(), script])
    }

    fn temp_count_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "effect-desktop-{name}-{}-{unique}.txt",
            std::process::id()
        ))
    }

    fn wait_for_count(path: &Path, expected: usize) {
        let deadline = Instant::now() + EVENT_TIMEOUT;

        loop {
            let count = read_count(path);
            if count >= expected {
                return;
            }

            assert!(
                Instant::now() < deadline,
                "timed out waiting for runtime restart count {expected}; last count was {count}"
            );

            thread::sleep(Duration::from_millis(10));
        }
    }

    fn read_count(path: &Path) -> usize {
        fs::read_to_string(path)
            .ok()
            .and_then(|count| count.parse::<usize>().ok())
            .unwrap_or(0)
    }
}

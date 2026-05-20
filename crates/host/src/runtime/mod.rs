//! Runtime child-process supervision.

pub(crate) mod platform;

use crate::{
    methods,
    transport::framed::{FrameReader, FrameWriter},
};
use anyhow::{bail, Context, Result};
use host_protocol::HostProtocolEnvelope;
use serde_json::Value;
use std::{
    env::VarError,
    ffi::OsString,
    io::{self, BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::mpsc::{self, Receiver, RecvTimeoutError, Sender},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tracing::{debug, error, warn};

const RUNTIME_READY_EVENT: &str = "runtime.ready";
const RUNTIME_EXECUTABLE_ENV: &str = "EFFECT_DESKTOP_RUNTIME_EXECUTABLE";
const RUNTIME_PROFILE_ENV: &str = "EFFECT_DESKTOP_PROFILE";
const BUN_INSTALL_ENV: &str = "BUN_INSTALL";
const APP_MANIFEST_FILE: &str = "app-manifest.json";
const DEFAULT_RESTART_READY_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_DEV_RESTARTS: usize = 3;
const TERMINATION_GRACE: Duration = Duration::from_secs(5);
const TERMINATION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MONITOR_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeConfig {
    executable: PathBuf,
    args: Vec<OsString>,
    envs: Vec<(OsString, OsString)>,
    cwd: Option<PathBuf>,
}

impl RuntimeConfig {
    pub(crate) fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: resolve_runtime_executable(executable.into()),
            args: Vec::new(),
            envs: Vec::new(),
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

    pub(crate) fn env(mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.envs.push((key.into(), value.into()));
        self
    }

    pub(crate) fn cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }

    pub(crate) fn from_manifest_path(path: &Path) -> Result<Self> {
        let source = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read runtime manifest {}", path.display()))?;
        let layout_root = path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("runtime manifest path has no parent"))?;
        Self::from_manifest_str(&source, layout_root)
    }

    pub(crate) fn from_manifest_str(source: &str, layout_root: &Path) -> Result<Self> {
        let value: Value =
            serde_json::from_str(source).context("failed to parse app-manifest.json")?;
        let runtime = value
            .get("runtimeManifest")
            .ok_or_else(|| anyhow::anyhow!("app-manifest.json.runtimeManifest is required"))?;
        let runtime = runtime.as_object().ok_or_else(|| {
            anyhow::anyhow!("app-manifest.json.runtimeManifest must be an object")
        })?;
        let engine = manifest_line_safe_string(runtime.get("engine"), "runtimeManifest.engine")?;
        if engine != "bun" && engine != "node" {
            bail!("app-manifest.json.runtimeManifest.engine must be bun or node");
        }
        let entry = manifest_path_string(runtime.get("entry"), "runtimeManifest.entry")?;
        let entry_path = layout_root.join(&entry);
        if !entry_path.is_file() {
            bail!(
                "app-manifest.json.runtimeManifest.entry does not exist at {}",
                entry_path.display()
            );
        }
        let executable =
            manifest_line_safe_string(runtime.get("executable"), "runtimeManifest.executable")?;
        if executable != engine {
            bail!("app-manifest.json.runtimeManifest.executable must match runtimeManifest.engine");
        }
        let args = runtime
            .get("args")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                anyhow::anyhow!("app-manifest.json.runtimeManifest.args must be an array")
            })?;
        if args.len() != 1 {
            bail!(
                "app-manifest.json.runtimeManifest.args must exactly equal [runtimeManifest.entry]"
            );
        }
        let mut config = RuntimeConfig::new(executable).cwd(layout_root);
        for (index, arg) in args.iter().enumerate() {
            let arg = manifest_path_string(Some(arg), &format!("runtimeManifest.args[{index}]"))?;
            if arg != entry {
                bail!(
                    "app-manifest.json.runtimeManifest.args must exactly equal [runtimeManifest.entry]"
                );
            }
            config = config.args([arg]);
        }
        let env = runtime
            .get("env")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                anyhow::anyhow!("app-manifest.json.runtimeManifest.env must be an object")
            })?;
        for (key, value) in env {
            if !is_runtime_env_key(key) {
                bail!(
                    "app-manifest.json.runtimeManifest.env key must be a line-safe string without ="
                );
            }
            config = config.env(
                key.as_str(),
                manifest_line_safe_string(Some(value), "runtimeManifest.env")?,
            );
        }
        Ok(config)
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.executable);
        command
            .args(&self.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in &self.envs {
            command.env(key, value);
        }

        if let Some(cwd) = &self.cwd {
            command.current_dir(cwd);
        }

        command
    }
}

pub(crate) fn manifest_path_for_exe(exe: &Path) -> Option<PathBuf> {
    let parent = exe.parent()?;
    if parent.file_name().and_then(|name| name.to_str()) == Some("native") {
        return parent.parent().map(|layout| layout.join(APP_MANIFEST_FILE));
    }

    let contents = parent.parent()?;
    if parent.file_name().and_then(|name| name.to_str()) == Some("MacOS")
        && contents.file_name().and_then(|name| name.to_str()) == Some("Contents")
    {
        return Some(
            contents
                .join("Resources")
                .join("effect-desktop")
                .join(APP_MANIFEST_FILE),
        );
    }

    None
}

fn manifest_line_safe_string(value: Option<&Value>, field: &str) -> Result<String> {
    let Some(value) = value.and_then(Value::as_str) else {
        bail!("app-manifest.json.{field} must be a string");
    };
    if !is_line_safe_string(value) {
        bail!("app-manifest.json.{field} must be a line-safe string");
    }
    Ok(value.to_string())
}

fn manifest_path_string(value: Option<&Value>, field: &str) -> Result<String> {
    let value = manifest_line_safe_string(value, field)?;
    if !is_contained_manifest_path(&value) {
        bail!("app-manifest.json.{field} must be a relative path inside the build layout");
    }
    Ok(value)
}

fn is_line_safe_string(value: &str) -> bool {
    !value.is_empty() && !value.contains('\0') && !value.contains('\n') && !value.contains('\r')
}

fn is_contained_manifest_path(value: &str) -> bool {
    !Path::new(value).is_absolute()
        && !value.contains('\\')
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn is_runtime_env_key(value: &str) -> bool {
    is_line_safe_string(value) && !value.contains('=')
}

fn resolve_runtime_executable(executable: PathBuf) -> PathBuf {
    resolve_runtime_executable_from_env(
        executable,
        std::env::var_os(RUNTIME_EXECUTABLE_ENV),
        std::env::var_os(BUN_INSTALL_ENV),
    )
}

fn resolve_runtime_executable_from_env(
    executable: PathBuf,
    runtime_executable: Option<OsString>,
    bun_install: Option<OsString>,
) -> PathBuf {
    if let Some(runtime_executable) = non_empty_os_string(runtime_executable) {
        return PathBuf::from(runtime_executable);
    }

    if executable.as_os_str() == "bun" {
        if let Some(bun_install) = non_empty_os_string(bun_install) {
            return PathBuf::from(bun_install)
                .join("bin")
                .join(bun_executable_name());
        }
    }

    executable
}

fn non_empty_os_string(value: Option<OsString>) -> Option<OsString> {
    value.filter(|value| !value.is_empty())
}

#[cfg(windows)]
fn bun_executable_name() -> &'static str {
    "bun.exe"
}

#[cfg(not(windows))]
fn bun_executable_name() -> &'static str {
    "bun"
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
    method_router: methods::HostMethodRouter,
    child: Option<RuntimeChild>,
    monitor_shutdown: Option<Sender<MonitorCommand>>,
    monitor_thread: Option<JoinHandle<()>>,
}

impl Supervisor {
    pub(crate) fn spawn(
        config: RuntimeConfig,
        policy: RestartPolicy,
        method_router: methods::HostMethodRouter,
    ) -> Result<Self> {
        let child = spawn_runtime_child(&config, method_router.clone())?;

        Ok(Self {
            config,
            policy,
            method_router,
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
            self.method_router.clone(),
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
    let deadline = checked_ready_deadline(timeout)?;
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

fn checked_ready_deadline(timeout: Duration) -> Result<Instant> {
    Instant::now().checked_add(timeout).ok_or_else(|| {
        anyhow::anyhow!("failed to schedule runtime ready timeout after {timeout:?}: duration overflows system time")
    })
}

fn spawn_runtime_child(
    config: &RuntimeConfig,
    method_router: methods::HostMethodRouter,
) -> Result<RuntimeChild> {
    let mut command = config.command();
    platform::configure_command(&mut command);

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to spawn runtime executable {:?}", config.executable))?;
    let pid = child.id();
    let stdin = child
        .stdin
        .take()
        .context("failed to capture runtime stdin")?;
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

    let stdout_thread = spawn_stdout_driver(stdout, stdin, event_tx.clone(), method_router);
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
    method_router: methods::HostMethodRouter,
    child: RuntimeChild,
    shutdown: Receiver<MonitorCommand>,
) -> JoinHandle<()> {
    thread::spawn(move || monitor_runtime(config, policy, method_router, child, shutdown))
}

fn monitor_runtime(
    config: RuntimeConfig,
    policy: RestartPolicy,
    method_router: methods::HostMethodRouter,
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

                match next_stdio_error_terminal_event(&child.events) {
                    Some(RuntimeEvent::Exited { status }) => {
                        let Some(next_child) = handle_runtime_exit(
                            status,
                            child,
                            &config,
                            policy,
                            &method_router,
                            &mut completed_restarts,
                            &shutdown,
                        ) else {
                            break;
                        };
                        child = next_child;
                    }
                    Some(RuntimeEvent::LifecycleError { error }) => {
                        error!(error, "runtime lifecycle failed after stdio error");
                        finish_runtime_child(child);
                        break;
                    }
                    Some(event) => {
                        warn!(?event, "terminating runtime after stdio error");
                        terminate_runtime_child(child);
                        break;
                    }
                    None => {
                        terminate_runtime_child(child);
                        break;
                    }
                }
            }
            MonitorNext::Event(RuntimeEvent::LifecycleError { error }) => {
                error!(error, "runtime lifecycle failed");
                finish_runtime_child(child);
                break;
            }
            MonitorNext::Event(RuntimeEvent::Exited { status }) => {
                let Some(next_child) = handle_runtime_exit(
                    status,
                    child,
                    &config,
                    policy,
                    &method_router,
                    &mut completed_restarts,
                    &shutdown,
                ) else {
                    break;
                };
                child = next_child;
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

fn handle_runtime_exit(
    status: ExitStatus,
    child: RuntimeChild,
    config: &RuntimeConfig,
    policy: RestartPolicy,
    method_router: &methods::HostMethodRouter,
    completed_restarts: &mut usize,
    shutdown: &Receiver<MonitorCommand>,
) -> Option<RuntimeChild> {
    finish_runtime_child(child);

    if status.success() {
        debug!(%status, "runtime exited cleanly");
        return None;
    }

    if !policy.should_restart(*completed_restarts) {
        error!(
            %status,
            profile = policy.profile.as_str(),
            completed_restarts = *completed_restarts,
            max_restarts = policy.max_dev_restarts,
            "runtime crashed; not restarting"
        );
        return None;
    }

    *completed_restarts += 1;
    warn!(
        %status,
        completed_restarts = *completed_restarts,
        max_restarts = policy.max_dev_restarts,
        "runtime crashed; restarting in dev profile"
    );

    let next_child = match spawn_runtime_child(config, method_router.clone()) {
        Ok(child) => child,
        Err(error) => {
            error!(%error, "failed to restart runtime after crash");
            return None;
        }
    };

    match await_ready_events_or_shutdown(&next_child.events, policy.ready_timeout, shutdown) {
        ReadyWait::Ready(Ok(ready)) => {
            warn!(
                version = ready.version(),
                completed_restarts = *completed_restarts,
                "runtime restarted and became ready"
            );
            Some(next_child)
        }
        ReadyWait::Ready(Err(error)) => {
            error!(%error, "restarted runtime failed before ready");
            terminate_runtime_child(next_child);
            None
        }
        ReadyWait::Shutdown => {
            terminate_runtime_child(next_child);
            None
        }
    }
}

fn next_stdio_error_terminal_event(events: &Receiver<RuntimeEvent>) -> Option<RuntimeEvent> {
    events.recv_timeout(MONITOR_POLL_INTERVAL).ok()
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
    let deadline = match checked_ready_deadline(timeout) {
        Ok(deadline) => deadline,
        Err(error) => return ReadyWait::Ready(Err(error)),
    };
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

fn spawn_stdout_driver<R, W>(
    stdout: R,
    stdin: W,
    events: Sender<RuntimeEvent>,
    method_router: methods::HostMethodRouter,
) -> JoinHandle<()>
where
    R: Read + Send + 'static,
    W: Write + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);

        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => return,
                Ok(_) => {
                    trim_line_end(&mut line);
                    let is_ready = matches!(parse_runtime_ready_line(&line), Ok(Some(_)));
                    if events
                        .send(RuntimeEvent::Stdout { line: line.clone() })
                        .is_err()
                    {
                        return;
                    }

                    if is_ready {
                        break;
                    }
                }
                Err(error) => {
                    let _ = events.send(RuntimeEvent::StdioError {
                        stream: RuntimeStream::Stdout,
                        error: error.to_string(),
                    });
                    return;
                }
            }
        }

        if let Err(error) = serve_framed_host_requests(reader, stdin, &method_router) {
            let _ = events.send(RuntimeEvent::StdioError {
                stream: RuntimeStream::Stdout,
                error: format!(
                    "runtime failed while reading runtime protocol after {RUNTIME_READY_EVENT}: {error}"
                ),
            });
        }
    })
}

pub(crate) fn serve_framed_host_requests<R, W>(
    reader: R,
    writer: W,
    method_router: &methods::HostMethodRouter,
) -> Result<()>
where
    R: Read,
    W: Write + Send,
{
    let mut reader = FrameReader::new(reader);
    let (outgoing_tx, outgoing_rx) = mpsc::channel::<HostProtocolEnvelope>();
    let (session_failure_tx, session_failure_rx) = mpsc::channel();
    method_router
        .install_runtime_event_sender(outgoing_tx.clone())
        .map_err(|error| anyhow::anyhow!("failed to install runtime event sender: {error}"))?;
    method_router
        .install_runtime_session_failure_sender(session_failure_tx.clone())
        .map_err(|error| {
            anyhow::anyhow!("failed to install runtime session failure sender: {error}")
        })?;

    let result = thread::scope(|scope| -> Result<()> {
        let writer_thread = scope.spawn(move || -> Result<()> {
            let mut writer = FrameWriter::new(writer);
            while let Ok(frame) = outgoing_rx.recv() {
                let frame = serde_json::to_vec(&frame).context(format!(
                    "failed to encode host protocol response after {RUNTIME_READY_EVENT}"
                ))?;
                writer.send(&frame).context(format!(
                    "failed to write host protocol response after {RUNTIME_READY_EVENT}"
                ))?;
            }
            Ok(())
        });
        let failure_router = method_router.clone();
        let failure_thread = scope.spawn(move || {
            while let Ok(key) = session_failure_rx.recv() {
                failure_router.handle_realtime_media_session_failure(key);
            }
        });

        let read_result = (|| -> Result<()> {
            while let Some(frame) = reader.recv().context(format!(
                "failed to read runtime protocol frame after {RUNTIME_READY_EVENT}"
            ))? {
                let envelope: HostProtocolEnvelope = serde_json::from_slice(&frame).context(
                    format!("failed to decode host protocol frame after {RUNTIME_READY_EVENT}"),
                )?;

                if dispatch_runtime_request_async(&envelope) {
                    method_router
                        .track_pending_local_tool_runtime_run_request(&envelope)
                        .map_err(|error| {
                            anyhow::anyhow!(
                                "failed to track pending local tool runtime request: {error}"
                            )
                        })?;
                    let router = method_router.clone();
                    let sender = outgoing_tx.clone();
                    scope.spawn(move || {
                        for frame in router.dispatch_frames(envelope) {
                            if sender.send(frame).is_err() {
                                break;
                            }
                        }
                    });
                } else {
                    for frame in method_router.dispatch_frames(envelope) {
                        outgoing_tx.send(frame).context(format!(
                            "failed to queue host protocol response after {RUNTIME_READY_EVENT}"
                        ))?;
                    }
                }
            }

            Ok(())
        })();

        let clear_failure_sender = method_router
            .clear_runtime_session_failure_sender()
            .map_err(|error| {
                anyhow::anyhow!("failed to clear runtime session failure sender: {error}")
            });
        let clear_sender = method_router
            .clear_runtime_event_sender()
            .map_err(|error| anyhow::anyhow!("failed to clear runtime event sender: {error}"));
        let cleanup = method_router.clear_runtime_resources().map_err(|error| {
            anyhow::anyhow!("failed to clear host runtime resources after disconnect: {error}")
        });
        drop(session_failure_tx);
        drop(outgoing_tx);
        let failure_result = failure_thread
            .join()
            .map_err(|_| anyhow::anyhow!("runtime session failure thread panicked"));
        let write_result = writer_thread
            .join()
            .unwrap_or_else(|_| Err(anyhow::anyhow!("runtime frame writer thread panicked")));

        read_result
            .and(clear_failure_sender)
            .and(clear_sender)
            .and(cleanup)
            .and(failure_result)
            .and(write_result)
    });
    result
}

fn dispatch_runtime_request_async(envelope: &HostProtocolEnvelope) -> bool {
    matches!(
        envelope,
        HostProtocolEnvelope::Request { method, .. }
            if method == host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD
    )
}

fn trim_line_end(line: &mut String) {
    while line.ends_with('\n') || line.ends_with('\r') {
        line.pop();
    }
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
        await_ready, await_ready_events, bun_executable_name, manifest_path_for_exe,
        monitor_runtime, parse_runtime_ready_line, resolve_runtime_executable_from_env,
        RestartPolicy, RuntimeChild, RuntimeConfig, RuntimeEvent, RuntimeProfile, RuntimeReady,
        RuntimeStream, Supervisor, Termination,
    };
    #[cfg(unix)]
    use std::os::unix::net::UnixStream;
    use std::{
        ffi::OsString,
        fs,
        io::Cursor,
        path::{Path, PathBuf},
        sync::{
            mpsc::{self, Receiver},
            Arc,
        },
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    use crate::{
        methods::HostMethodRouter,
        transport::framed::{FrameReader, FrameWriter},
        window::WindowMethodPort,
    };
    use host_protocol::{HostProtocolEnvelope, PROTOCOL_VERSION};

    const EVENT_TIMEOUT: Duration = Duration::from_secs(5);
    const RUNTIME_HANDSHAKE_SCRIPT: &str = r#"
const fs = require("node:fs");
const { Buffer } = require("node:buffer");
const expectedProtocolVersion = "__PROTOCOL_VERSION__";

function writeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length, 0);
  fs.writeSync(1, prefix);
  fs.writeSync(1, body);
}

function readExactly(byteLength) {
  const buffer = Buffer.alloc(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const read = fs.readSync(0, buffer, offset, byteLength - offset, null);
    if (read === 0) {
      throw new Error(`stdin closed after ${offset} of ${byteLength} bytes`);
    }
    offset += read;
  }
  return buffer;
}

function readFrame() {
  const prefix = readExactly(4);
  const byteLength = prefix.readUInt32BE(0);
  return JSON.parse(readExactly(byteLength).toString("utf8"));
}

console.log(JSON.stringify({ event: "runtime.ready", version: "test" }));

writeFrame({
  kind: "request",
  id: "request-version",
  method: "host.version",
  timestamp: 1710000000000,
  traceId: "trace-version"
});
const version = readFrame();
if (
  version.kind !== "response" ||
  version.id !== "request-version" ||
  version.traceId !== "trace-version" ||
  version.error !== undefined ||
  version.payload?.protocolVersion !== expectedProtocolVersion
) {
  throw new Error(`unexpected host.version response: ${JSON.stringify(version)}`);
}

writeFrame({
  kind: "request",
  id: "request-ping",
  method: "host.ping",
  timestamp: 1710000000001,
  traceId: "trace-ping"
});
const ping = readFrame();
if (
  ping.kind !== "response" ||
  ping.id !== "request-ping" ||
  ping.traceId !== "trace-ping" ||
  ping.error !== undefined ||
  ping.payload !== undefined
) {
  throw new Error(`unexpected host.ping response: ${JSON.stringify(ping)}`);
}
"#;
    const RUNTIME_POST_READY_STDOUT_SCRIPT: &str = r#"console.log(JSON.stringify({ event: "runtime.ready", version: "test" }));
console.log("this is not framed");
"#;

    #[test]
    fn runtime_config_resolves_bun_from_explicit_runtime_executable_env() {
        let executable = resolve_runtime_executable_from_env(
            PathBuf::from("bun"),
            Some(OsString::from("/opt/effect-desktop/bin/bun")),
            Some(OsString::from("/ignored/bun-install")),
        );

        assert_eq!(executable, PathBuf::from("/opt/effect-desktop/bin/bun"));
    }

    #[test]
    fn runtime_config_resolves_bun_from_bun_install_env() {
        let executable = resolve_runtime_executable_from_env(
            PathBuf::from("bun"),
            None,
            Some(OsString::from("/opt/bun")),
        );

        assert_eq!(
            executable,
            PathBuf::from("/opt/bun")
                .join("bin")
                .join(bun_executable_name())
        );
    }

    #[test]
    fn runtime_config_resolves_non_bun_from_explicit_runtime_executable_env() {
        let executable = resolve_runtime_executable_from_env(
            PathBuf::from("node"),
            Some(OsString::from("/opt/effect-desktop/bin/node")),
            Some(OsString::from("/opt/bun")),
        );

        assert_eq!(executable, PathBuf::from("/opt/effect-desktop/bin/node"));
    }

    #[test]
    fn runtime_config_preserves_non_bun_executables_without_override() {
        let executable = resolve_runtime_executable_from_env(
            PathBuf::from("/usr/bin/node"),
            None,
            Some(OsString::from("/opt/bun")),
        );

        assert_eq!(executable, PathBuf::from("/usr/bin/node"));
    }

    #[test]
    fn runtime_config_reads_bun_manifest_launch_contract() {
        let layout = temp_runtime_layout("bun");
        fs::create_dir_all(layout.join("runtime")).expect("runtime dir");
        fs::write(
            layout.join("runtime").join("main.js"),
            "console.log('runtime')\n",
        )
        .expect("runtime entry");
        let manifest = r#"{
  "runtimeManifest": {
    "engine": "bun",
    "entry": "runtime/main.js",
    "executable": "bun",
    "args": ["runtime/main.js"],
    "env": { "LOG_LEVEL": "debug" }
  }
}"#;

        let config = RuntimeConfig::from_manifest_str(manifest, &layout).expect("manifest config");
        let config_debug = format!("{config:?}");

        assert!(config_debug.contains("bun"), "{config_debug}");
        assert!(config_debug.contains("runtime/main.js"), "{config_debug}");
        assert!(config_debug.contains("LOG_LEVEL"), "{config_debug}");
        assert!(config_debug.contains("debug"), "{config_debug}");
    }

    #[test]
    fn runtime_config_reads_node_manifest_launch_contract() {
        let layout = temp_runtime_layout("node");
        fs::create_dir_all(layout.join("runtime")).expect("runtime dir");
        fs::write(
            layout.join("runtime").join("main.js"),
            "console.log('runtime')\n",
        )
        .expect("runtime entry");
        let manifest = r#"{
  "runtimeManifest": {
    "engine": "node",
    "entry": "runtime/main.js",
    "executable": "node",
    "args": ["runtime/main.js"],
    "env": {}
  }
}"#;

        let config = RuntimeConfig::from_manifest_str(manifest, &layout).expect("manifest config");
        let config_debug = format!("{config:?}");

        assert!(config_debug.contains("\"node\""), "{config_debug}");
        assert!(config_debug.contains("runtime/main.js"), "{config_debug}");
    }

    #[test]
    fn runtime_manifest_rejects_unsupported_engines() {
        let layout = temp_runtime_layout("deno");
        fs::create_dir_all(layout.join("runtime")).expect("runtime dir");
        fs::write(
            layout.join("runtime").join("main.js"),
            "console.log('runtime')\n",
        )
        .expect("runtime entry");
        let manifest = r#"{
  "runtimeManifest": {
    "engine": "deno",
    "entry": "runtime/main.js",
    "executable": "deno",
    "args": ["runtime/main.js"],
    "env": {}
  }
}"#;

        let error = RuntimeConfig::from_manifest_str(manifest, &layout)
            .expect_err("unsupported engine should fail");

        assert_eq!(
            error.to_string(),
            "app-manifest.json.runtimeManifest.engine must be bun or node"
        );
    }

    #[test]
    fn runtime_manifest_rejects_args_that_do_not_match_entry() {
        let layout = temp_runtime_layout("arg-mismatch");
        fs::create_dir_all(layout.join("runtime")).expect("runtime dir");
        fs::write(
            layout.join("runtime").join("main.js"),
            "console.log('runtime')\n",
        )
        .expect("runtime entry");
        let manifest = r#"{
  "runtimeManifest": {
    "engine": "node",
    "entry": "runtime/main.js",
    "executable": "node",
    "args": ["runtime/other.js"],
    "env": {}
  }
}"#;

        let error = RuntimeConfig::from_manifest_str(manifest, &layout)
            .expect_err("arg mismatch should fail");

        assert_eq!(
            error.to_string(),
            "app-manifest.json.runtimeManifest.args must exactly equal [runtimeManifest.entry]"
        );
    }

    #[test]
    fn runtime_manifest_rejects_entry_path_traversal() {
        let layout = temp_runtime_layout("entry-traversal");
        let manifest = r#"{
  "runtimeManifest": {
    "engine": "node",
    "entry": "../outside.js",
    "executable": "node",
    "args": ["../outside.js"],
    "env": {}
  }
}"#;

        let error = RuntimeConfig::from_manifest_str(manifest, &layout)
            .expect_err("entry traversal should fail");

        assert_eq!(
            error.to_string(),
            "app-manifest.json.runtimeManifest.entry must be a relative path inside the build layout"
        );
    }

    #[test]
    fn runtime_manifest_rejects_invalid_env_keys() {
        let layout = temp_runtime_layout("env-key");
        fs::create_dir_all(layout.join("runtime")).expect("runtime dir");
        fs::write(
            layout.join("runtime").join("main.js"),
            "console.log('runtime')\n",
        )
        .expect("runtime entry");
        let manifest = r#"{
  "runtimeManifest": {
    "engine": "node",
    "entry": "runtime/main.js",
    "executable": "node",
    "args": ["runtime/main.js"],
    "env": { "BAD=KEY": "value" }
  }
}"#;

        let error = RuntimeConfig::from_manifest_str(manifest, &layout)
            .expect_err("invalid env key should fail");

        assert_eq!(
            error.to_string(),
            "app-manifest.json.runtimeManifest.env key must be a line-safe string without ="
        );
    }

    #[test]
    fn runtime_manifest_path_points_from_native_binary_to_layout_manifest() {
        let path = manifest_path_for_exe(Path::new("/app/layout/native/host"))
            .expect("manifest path should resolve");

        assert_eq!(path, Path::new("/app/layout/app-manifest.json"));
    }

    #[test]
    fn runtime_manifest_path_points_from_macos_bundle_to_resource_manifest() {
        let path = manifest_path_for_exe(Path::new("/App/Foo.app/Contents/MacOS/Foo"))
            .expect("manifest path should resolve");

        assert_eq!(
            path,
            Path::new("/App/Foo.app/Contents/Resources/effect-desktop/app-manifest.json")
        );
    }

    #[test]
    fn supervisor_emits_started_stdio_and_exit_events() {
        let supervisor = Supervisor::spawn(
            RuntimeConfig::new("bun").args([
                "-e",
                "console.log('runtime stdout'); console.error('runtime stderr');",
            ]),
            test_policy(RuntimeProfile::Prod, 0, EVENT_TIMEOUT),
            test_router(),
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
        let supervisor = Supervisor::spawn(
            RuntimeConfig::new("bun").args([
                "-e",
                "Bun.spawn(['bun', '-e', 'setInterval(() => {}, 1000)'], { stdout: 'inherit', stderr: 'inherit' }); console.log('parent done'); process.exit(0);",
            ]),
            test_policy(RuntimeProfile::Prod, 0, EVENT_TIMEOUT),
            test_router(),
        )
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
            test_router(),
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
    fn framed_runtime_requests_receive_host_responses() {
        let request = HostProtocolEnvelope::Request {
            id: "request-version".to_string(),
            method: "host.version".to_string(),
            timestamp: 1710000000000,
            trace_id: "trace-version".to_string(),
            window_id: None,
            origin_token: None,
            payload: None,
        };
        let request_bytes = serde_json::to_vec(&request).expect("request should encode");
        let mut input = Vec::new();
        FrameWriter::new(&mut input)
            .send(&request_bytes)
            .expect("request frame should encode");
        let mut output = Vec::new();

        super::serve_framed_host_requests(Cursor::new(input), &mut output, &test_router())
            .expect("host request should dispatch");

        let mut reader = FrameReader::new(Cursor::new(output));
        let response_frame = reader
            .recv()
            .expect("response should decode")
            .expect("response frame should exist");
        let response: HostProtocolEnvelope =
            serde_json::from_slice(&response_frame).expect("response should decode");
        let timestamp = match &response {
            HostProtocolEnvelope::Response { timestamp, .. } => *timestamp,
            _ => unreachable!("response frame must be a response envelope"),
        };

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-version".to_string(),
                timestamp,
                trace_id: "trace-version".to_string(),
                payload: Some(serde_json::json!({
                    "protocolVersion": PROTOCOL_VERSION
                })),
                error: None,
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn framed_runtime_can_stop_active_local_tool_run() {
        let root = unique_temp_dir("local-tool-runtime-framed-stop");
        fs::create_dir_all(&root).expect("temp dir should be created");
        let executable = root.join("sleep.sh");
        write_executable(&executable, "#!/bin/sh\nsleep 30\n");
        let (input_reader, input_writer) = UnixStream::pair().expect("input socket pair");
        let (mut output_reader, output_writer) = UnixStream::pair().expect("output socket pair");
        output_reader
            .set_read_timeout(Some(EVENT_TIMEOUT))
            .expect("output reader timeout should be set");

        let server = thread::spawn(move || {
            super::serve_framed_host_requests(input_reader, output_writer, &test_router())
                .expect("framed runtime should dispatch");
        });
        let mut frame_writer = FrameWriter::new(input_writer);
        let mut frame_reader = FrameReader::new(&mut output_reader);

        write_host_frame(
            &mut frame_writer,
            &local_tool_runtime_request(
                "register",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                local_tool_runtime_register_payload(&root, "runtime-framed-stop", &executable),
            ),
        );
        let register_frames = read_host_frames_until(
            &mut frame_reader,
            |frame| is_response_id(frame, "request-local-tool-runtime-register"),
            "register response",
        );
        assert!(
            register_frames
                .iter()
                .any(|frame| is_local_tool_runtime_event(frame, "registered")),
            "registered event missing: {register_frames:?}"
        );

        write_host_frame(
            &mut frame_writer,
            &local_tool_runtime_request(
                "run-stop",
                host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
                serde_json::json!({
                    "runtimeId": "runtime-framed-stop",
                    "commandId": "sleep",
                    "runId": "run-framed-stop"
                }),
            ),
        );
        let run_frames = read_host_frames_until(
            &mut frame_reader,
            |frame| is_local_tool_runtime_event(frame, "run-started"),
            "run-started event",
        );
        assert!(
            run_frames
                .iter()
                .any(|frame| is_local_tool_runtime_event(frame, "run-started")),
            "run-started event missing: {run_frames:?}"
        );

        assert!(
            write_and_wait_for_stop_response(
                &mut frame_writer,
                &mut frame_reader,
                "runtime-framed-stop"
            ) < Duration::from_secs(2),
            "stop response must not wait for the local tool timeout"
        );
        drop(frame_writer);
        server.join().expect("framed runtime thread should join");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn framed_runtime_cancel_stops_active_local_tool_run() {
        let root = unique_temp_dir("local-tool-runtime-framed-cancel");
        fs::create_dir_all(&root).expect("temp dir should be created");
        let executable = root.join("sleep.sh");
        write_executable(&executable, "#!/bin/sh\nsleep 30\n");
        let (input_reader, input_writer) = UnixStream::pair().expect("input socket pair");
        let (mut output_reader, output_writer) = UnixStream::pair().expect("output socket pair");
        output_reader
            .set_read_timeout(Some(EVENT_TIMEOUT))
            .expect("output reader timeout should be set");

        let server = thread::spawn(move || {
            super::serve_framed_host_requests(input_reader, output_writer, &test_router())
                .expect("framed runtime should dispatch");
        });
        let mut frame_writer = FrameWriter::new(input_writer);
        let mut frame_reader = FrameReader::new(&mut output_reader);

        write_host_frame(
            &mut frame_writer,
            &local_tool_runtime_request(
                "register",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                local_tool_runtime_register_payload(&root, "runtime-framed-cancel", &executable),
            ),
        );
        read_host_frames_until(
            &mut frame_reader,
            |frame| is_response_id(frame, "request-local-tool-runtime-register"),
            "register response",
        );

        write_host_frame(
            &mut frame_writer,
            &local_tool_runtime_request(
                "run-cancel",
                host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
                serde_json::json!({
                    "runtimeId": "runtime-framed-cancel",
                    "commandId": "sleep",
                    "runId": "run-framed-cancel"
                }),
            ),
        );
        read_host_frames_until(
            &mut frame_reader,
            |frame| is_local_tool_runtime_event(frame, "run-started"),
            "run-started event",
        );

        let started = Instant::now();
        write_host_frame(
            &mut frame_writer,
            &HostProtocolEnvelope::Cancel {
                id: Some("request-local-tool-runtime-run-cancel".to_string()),
                resource_id: None,
                timestamp: 1710000000001,
                trace_id: "trace-local-tool-runtime-cancel".to_string(),
            },
        );
        let cancel_frames = read_host_frames_until(
            &mut frame_reader,
            |frame| is_response_id(frame, "request-local-tool-runtime-run-cancel"),
            "run response after cancel",
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "cancel response must not wait for the local tool timeout"
        );
        assert!(
            !cancel_frames
                .iter()
                .any(|frame| is_local_tool_runtime_event(frame, "run-completed")),
            "canceled run must not emit run-completed: {cancel_frames:?}"
        );

        drop(frame_writer);
        server.join().expect("framed runtime thread should join");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn framed_runtime_extension_config_requests_use_host_persistence_and_events() {
        let _guard = crate::methods::EXTENSION_CONFIG_ENV_LOCK
            .lock()
            .expect("extension config env lock should not be poisoned");
        let dir = unique_temp_dir("extension-config-framed-runtime");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let store_path = dir.join("extension-config.json");
        let previous_store_path = std::env::var_os("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE");
        std::env::set_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE", &store_path);
        let mut input = Vec::new();
        {
            let mut writer = FrameWriter::new(&mut input);
            for request in [
                extension_config_request(
                    "write",
                    host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "extensionId": "extension-1",
                        "fields": extension_config_fields(),
                        "values": [{ "key": "theme", "value": "dark" }],
                        "secretKeys": ["apiKey"],
                        "traceId": "trace-extension-config"
                    }),
                ),
                extension_config_request(
                    "read",
                    host_protocol::EXTENSION_CONFIG_READ_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "extensionId": "extension-1",
                        "fields": extension_config_fields(),
                        "traceId": "trace-extension-config"
                    }),
                ),
                extension_config_request(
                    "redact",
                    host_protocol::EXTENSION_CONFIG_REDACT_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "extensionId": "extension-1",
                        "fields": extension_config_fields(),
                        "traceId": "trace-extension-config"
                    }),
                ),
                extension_config_request(
                    "reset",
                    host_protocol::EXTENSION_CONFIG_RESET_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "extensionId": "extension-1",
                        "fields": extension_config_fields(),
                        "keys": ["theme", "apiKey"],
                        "traceId": "trace-extension-config"
                    }),
                ),
            ] {
                let request_bytes = serde_json::to_vec(&request).expect("request should encode");
                writer
                    .send(&request_bytes)
                    .expect("request frame should encode");
            }
        }
        let mut output = Vec::new();

        super::serve_framed_host_requests(Cursor::new(input), &mut output, &test_router())
            .expect("extension config frames should dispatch");

        match previous_store_path {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE"),
        }
        let _ = fs::remove_dir_all(dir);

        let mut reader = FrameReader::new(Cursor::new(output));
        let mut frames = Vec::new();
        while let Some(frame) = reader.recv().expect("response frame should decode") {
            frames.push(
                serde_json::from_slice::<HostProtocolEnvelope>(&frame)
                    .expect("host protocol frame should decode"),
            );
        }
        frames.retain(|frame| !is_power_monitor_event(frame));

        assert_eq!(frames.len(), 8);
        assert_extension_config_event(&frames[0], "written", Some(1));
        assert_extension_config_response(
            &frames[1],
            "request-extension-config-write",
            serde_json::json!({
                "extensionId": "extension-1",
                "writtenKeys": ["theme", "apiKey"],
                "revision": 1
            }),
        );
        assert_extension_config_event(&frames[2], "read", Some(1));
        assert_extension_config_response(
            &frames[3],
            "request-extension-config-read",
            serde_json::json!({
                "extensionId": "extension-1",
                "values": [{ "key": "theme", "value": "dark" }],
                "secrets": [{ "key": "apiKey", "present": true }],
                "revision": 1
            }),
        );
        assert_extension_config_event(&frames[4], "redacted", None);
        assert_extension_config_response(
            &frames[5],
            "request-extension-config-redact",
            serde_json::json!({
                "extensionId": "extension-1",
                "values": [
                    { "key": "theme", "value": "dark" },
                    { "key": "apiKey", "value": "<redacted:ExtensionConfigSecret>" }
                ],
                "redactions": [{ "key": "apiKey", "reason": "secret-field" }]
            }),
        );
        assert_extension_config_event(&frames[6], "reset", Some(2));
        assert_extension_config_response(
            &frames[7],
            "request-extension-config-reset",
            serde_json::json!({
                "extensionId": "extension-1",
                "resetKeys": ["theme", "apiKey"],
                "revision": 2
            }),
        );
    }

    #[test]
    fn framed_runtime_extension_package_requests_use_host_persistence_and_events() {
        let _guard = crate::methods::EXTENSION_PACKAGE_ENV_LOCK
            .lock()
            .expect("extension package env lock should not be poisoned");
        let dir = unique_temp_dir("extension-package-framed-runtime");
        let source = dir.join("source");
        fs::create_dir_all(source.join("dist")).expect("source dir should be created");
        fs::write(source.join("dist/main.js"), "export default 1\n")
            .expect("source file should be written");
        let store_path = dir.join("store");
        let previous_store_path = std::env::var_os("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE");
        std::env::set_var("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE", &store_path);
        let mut input = Vec::new();
        {
            let mut writer = FrameWriter::new(&mut input);
            for request in [
                extension_package_request(
                    "install",
                    host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
                    extension_package_install_payload(&source, "1.0.0", None),
                ),
                extension_package_request(
                    "list-installed",
                    host_protocol::EXTENSION_PACKAGE_LIST_METHOD,
                    serde_json::Value::Null,
                ),
                extension_package_request(
                    "update",
                    host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD,
                    extension_package_install_payload(&source, "1.1.0", Some("1.0.0")),
                ),
                extension_package_request(
                    "list-updated",
                    host_protocol::EXTENSION_PACKAGE_LIST_METHOD,
                    serde_json::Value::Null,
                ),
                extension_package_request(
                    "remove",
                    host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "packageId": "extension-1",
                        "traceId": "trace-extension-package"
                    }),
                ),
                extension_package_request(
                    "list-removed",
                    host_protocol::EXTENSION_PACKAGE_LIST_METHOD,
                    serde_json::Value::Null,
                ),
            ] {
                let request_bytes = serde_json::to_vec(&request).expect("request should encode");
                writer
                    .send(&request_bytes)
                    .expect("request frame should encode");
            }
        }
        let mut output = Vec::new();

        super::serve_framed_host_requests(Cursor::new(input), &mut output, &test_router())
            .expect("extension package frames should dispatch");

        match previous_store_path {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE"),
        }
        let _ = fs::remove_dir_all(dir);

        let mut reader = FrameReader::new(Cursor::new(output));
        let mut frames = Vec::new();
        while let Some(frame) = reader.recv().expect("response frame should decode") {
            frames.push(
                serde_json::from_slice::<HostProtocolEnvelope>(&frame)
                    .expect("host protocol frame should decode"),
            );
        }
        frames.retain(|frame| !is_power_monitor_event(frame));

        assert_eq!(frames.len(), 9);
        assert_extension_package_event(&frames[0], "installed", Some("1.0.0"), Some(1));
        assert_extension_package_response(
            &frames[1],
            "request-extension-package-install",
            serde_json::json!({
                "packageId": "extension-1",
                "version": "1.0.0",
                "revision": 1,
                "registeredCapabilities": [extension_package_capability()]
            }),
        );
        assert_extension_package_list(
            &frames[2],
            "request-extension-package-list-installed",
            1,
            "1.0.0",
        );
        assert_extension_package_event(&frames[3], "updated", Some("1.1.0"), Some(2));
        assert_extension_package_response(
            &frames[4],
            "request-extension-package-update",
            serde_json::json!({
                "packageId": "extension-1",
                "previousVersion": "1.0.0",
                "version": "1.1.0",
                "revision": 2,
                "registeredCapabilities": [extension_package_capability()]
            }),
        );
        assert_extension_package_list(
            &frames[5],
            "request-extension-package-list-updated",
            2,
            "1.1.0",
        );
        assert_extension_package_event(&frames[6], "removed", None, Some(3));
        assert_extension_package_response(
            &frames[7],
            "request-extension-package-remove",
            serde_json::json!({
                "packageId": "extension-1",
                "removed": true,
                "revision": 3
            }),
        );
        assert_extension_package_response(
            &frames[8],
            "request-extension-package-list-removed",
            serde_json::json!({ "packages": [] }),
        );
    }

    #[test]
    fn child_runtime_round_trips_ping_and_version_after_ready_for_bun_and_node() {
        for executable in runtime_provider_executables() {
            let script = RUNTIME_HANDSHAKE_SCRIPT.replace("__PROTOCOL_VERSION__", PROTOCOL_VERSION);
            let supervisor = Supervisor::spawn(
                RuntimeConfig::new(executable).args(["-e".to_string(), script]),
                test_policy(RuntimeProfile::Prod, 0, EVENT_TIMEOUT),
                test_router(),
            )
            .unwrap_or_else(|error| panic!("{executable} runtime child should spawn: {error}"));

            let events = collect_until_exit(supervisor.events());

            assert!(
                events.iter().any(
                    |event| matches!(event, RuntimeEvent::Stdout { line } if line == r#"{"event":"runtime.ready","version":"test"}"#)
                ),
                "{executable} events did not include ready stdout line: {events:?}"
            );
            assert!(
                events.iter().any(
                    |event| matches!(event, RuntimeEvent::Exited { status } if status.success())
                ),
                "{executable} events did not include successful exit: {events:?}"
            );
            assert_terminal_event_closes_channel(&supervisor);
        }
    }

    #[test]
    fn child_runtime_fails_if_plain_stdout_follows_ready_for_bun_and_node() {
        for executable in runtime_provider_executables() {
            let supervisor = Supervisor::spawn(
                RuntimeConfig::new(executable).args([
                    "-e".to_string(),
                    RUNTIME_POST_READY_STDOUT_SCRIPT.to_string(),
                ]),
                test_policy(RuntimeProfile::Prod, 0, EVENT_TIMEOUT),
                test_router(),
            )
            .unwrap_or_else(|error| panic!("{executable} runtime child should spawn: {error}"));

            let events = collect_until_exit(supervisor.events());

            assert!(
                events.iter().any(
                    |event| matches!(event, RuntimeEvent::Stdout { line } if line == r#"{"event":"runtime.ready","version":"test"}"#)
                ),
                "{executable} events did not include ready stdout line: {events:?}"
            );
            let runtime_stdio_error = events.iter().find_map(|event| {
                if let RuntimeEvent::StdioError {
                    stream: RuntimeStream::Stdout,
                    error,
                } = event
                {
                    Some(error.as_str())
                } else {
                    None
                }
            });

            assert!(
                matches!(
                    runtime_stdio_error,
                    Some(error) if error.contains("after runtime.ready")
                ),
                "{executable} events did not include framed-protocol violation: {events:?}"
            );
            assert_terminal_event_closes_channel(&supervisor);
        }
    }

    fn runtime_provider_executables() -> [&'static str; 2] {
        ["bun", "node"]
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
            test_router(),
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
    fn await_ready_events_rejects_overflowing_timeout() {
        let (_events_tx, events_rx) = mpsc::channel();

        let error = await_ready_events(&events_rx, Duration::MAX)
            .expect_err("an overflowing timeout should reject instead of panicking");

        assert!(
            error
                .to_string()
                .contains("failed to schedule runtime ready timeout after"),
            "unexpected error for overflowing timeout: {error}"
        );
    }

    #[test]
    fn dev_policy_restarts_nonzero_exit_after_ready() {
        let restart_count_path = temp_count_path("dev-restart");
        let _ = fs::remove_file(&restart_count_path);
        let mut supervisor = Supervisor::spawn(
            crash_once_runtime_config(&restart_count_path),
            test_policy(RuntimeProfile::Dev, 1, EVENT_TIMEOUT),
            test_router(),
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
            test_router(),
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
            test_router(),
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

    fn test_router() -> HostMethodRouter {
        HostMethodRouter::new(Arc::new(WindowMethodPort::new()))
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("effect-desktop-runtime-{nanos}-{name}"))
    }

    fn write_host_frame<W: std::io::Write>(
        writer: &mut FrameWriter<W>,
        envelope: &HostProtocolEnvelope,
    ) {
        let bytes = serde_json::to_vec(envelope).expect("host frame should encode");
        writer.send(&bytes).expect("host frame should write");
    }

    #[cfg(unix)]
    fn read_host_frames_until<R>(
        reader: &mut FrameReader<R>,
        matches_expected: impl Fn(&HostProtocolEnvelope) -> bool,
        expected: &str,
    ) -> Vec<HostProtocolEnvelope>
    where
        R: std::io::Read,
    {
        let mut frames = Vec::new();
        for _ in 0..8 {
            let frame = reader
                .recv()
                .expect("host frame should decode")
                .expect("host frame should exist");
            let envelope = serde_json::from_slice::<HostProtocolEnvelope>(&frame)
                .expect("host protocol frame should decode");
            let found = matches_expected(&envelope);
            frames.push(envelope);
            if found {
                return frames;
            }
        }

        panic!("{expected} missing: {frames:?}");
    }

    #[cfg(unix)]
    fn write_and_wait_for_stop_response<W, R>(
        writer: &mut FrameWriter<W>,
        reader: &mut FrameReader<R>,
        runtime_id: &str,
    ) -> Duration
    where
        W: std::io::Write,
        R: std::io::Read,
    {
        let started = Instant::now();
        write_host_frame(
            writer,
            &local_tool_runtime_request(
                "stop",
                host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD,
                serde_json::json!({ "runtimeId": runtime_id }),
            ),
        );
        read_host_frames_until(
            reader,
            |frame| is_response_id(frame, "request-local-tool-runtime-stop"),
            "stop response",
        );
        started.elapsed()
    }

    fn is_response_id(frame: &HostProtocolEnvelope, expected: &str) -> bool {
        matches!(
            frame,
            HostProtocolEnvelope::Response { id, error, .. } if id == expected && error.is_none()
        )
    }

    fn is_local_tool_runtime_event(frame: &HostProtocolEnvelope, expected_phase: &str) -> bool {
        matches!(
            frame,
            HostProtocolEnvelope::Event { method, payload, .. }
                if method == host_protocol::LOCAL_TOOL_RUNTIME_EVENT
                    && payload
                        .as_ref()
                        .and_then(|payload| payload.get("phase"))
                        .and_then(serde_json::Value::as_str)
                        == Some(expected_phase)
        )
    }

    fn local_tool_runtime_request(
        id: &str,
        method: &str,
        payload: serde_json::Value,
    ) -> HostProtocolEnvelope {
        HostProtocolEnvelope::Request {
            id: format!("request-local-tool-runtime-{id}"),
            method: method.to_string(),
            timestamp: 1710000000000,
            trace_id: format!("trace-local-tool-runtime-{id}"),
            window_id: None,
            origin_token: None,
            payload: Some(payload),
        }
    }

    fn local_tool_runtime_register_payload(
        root: &Path,
        runtime_id: &str,
        executable: &Path,
    ) -> serde_json::Value {
        let root = root.display().to_string();
        let executable = executable.display().to_string();
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "manifest": {
                "toolId": "tool-1",
                "name": "Tool One",
                "version": "1.0.0",
                "commands": [{
                    "commandId": "sleep",
                    "executable": executable,
                    "defaultArgs": [],
                    "cwd": root,
                    "environment": [],
                    "timeoutMillis": 30_000
                }],
                "permissions": [{
                    "kind": "process.spawn",
                    "commands": [executable],
                    "cwd": [root],
                    "environment": "none",
                    "shell": false,
                    "audit": "always"
                }],
                "policy": {
                    "cwd": { "roots": [root] },
                    "environment": { "variables": [] },
                    "filesystem": { "readRoots": [root] },
                    "network": { "hosts": [] },
                    "budgets": {
                        "cpuMillis": 9007199254740991u64,
                        "memoryBytes": 9007199254740991u64,
                        "wallClockMillis": 30_000,
                        "stdoutBytes": 1024,
                        "stderrBytes": 1024
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

    #[cfg(unix)]
    fn write_executable(path: &Path, contents: &str) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(path, contents).expect("script should write");
        let mut permissions = fs::metadata(path).expect("script metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("script should be executable");
    }

    fn extension_config_fields() -> serde_json::Value {
        serde_json::json!([
            {
                "key": "theme",
                "valueType": "string",
                "secret": false,
                "defaultValue": "light"
            },
            { "key": "apiKey", "valueType": "string", "secret": true }
        ])
    }

    fn extension_config_request(
        id: &str,
        method: &str,
        payload: serde_json::Value,
    ) -> HostProtocolEnvelope {
        HostProtocolEnvelope::Request {
            id: format!("request-extension-config-{id}"),
            method: method.to_string(),
            timestamp: 1710000000000,
            trace_id: format!("trace-extension-config-{id}"),
            window_id: None,
            origin_token: None,
            payload: Some(payload),
        }
    }

    fn extension_package_capability() -> serde_json::Value {
        serde_json::json!({
            "kind": "filesystem.read",
            "roots": ["/tmp/extensions"],
            "audit": "always"
        })
    }

    fn extension_package_install_payload(
        source: &Path,
        version: &str,
        expected_version: Option<&str>,
    ) -> serde_json::Value {
        let mut payload = serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "source": {
                "kind": "directory",
                "uri": source.to_string_lossy()
            },
            "manifest": {
                "id": "extension-1",
                "name": "Extension One",
                "version": version,
                "entrypoint": "dist/main.js",
                "compatibility": {
                    "minHostVersion": "1.0.0",
                    "maxHostVersion": "2.0.0"
                },
                "capabilities": [
                    {
                        "capability": extension_package_capability(),
                        "reason": "read extension files"
                    }
                ]
            },
            "traceId": "trace-extension-package"
        });
        if let Some(expected_version) = expected_version {
            payload["expectedVersion"] = serde_json::json!(expected_version);
        }
        payload
    }

    fn extension_package_request(
        id: &str,
        method: &str,
        payload: serde_json::Value,
    ) -> HostProtocolEnvelope {
        HostProtocolEnvelope::Request {
            id: format!("request-extension-package-{id}"),
            method: method.to_string(),
            timestamp: 1710000000000,
            trace_id: format!("trace-extension-package-{id}"),
            window_id: None,
            origin_token: None,
            payload: if payload.is_null() {
                None
            } else {
                Some(payload)
            },
        }
    }

    fn assert_extension_config_event(
        frame: &HostProtocolEnvelope,
        phase: &str,
        revision: Option<u64>,
    ) {
        let HostProtocolEnvelope::Event {
            method,
            payload: Some(payload),
            ..
        } = frame
        else {
            panic!("expected extension config event frame: {frame:?}");
        };
        assert_eq!(method, host_protocol::EXTENSION_CONFIG_EVENT);
        assert_eq!(payload["phase"], phase);
        assert_eq!(payload["extensionId"], "extension-1");
        assert_eq!(payload["keys"], serde_json::json!(["theme", "apiKey"]));
        match revision {
            Some(revision) => assert_eq!(payload["revision"], revision),
            None => assert!(payload.get("revision").is_none()),
        }
    }

    fn is_power_monitor_event(frame: &HostProtocolEnvelope) -> bool {
        matches!(
            frame,
            HostProtocolEnvelope::Event { method, .. }
                if method == host_protocol::POWER_MONITOR_POWER_SOURCE_CHANGED_EVENT
        )
    }

    fn assert_extension_config_response(
        frame: &HostProtocolEnvelope,
        id: &str,
        expected_payload: serde_json::Value,
    ) {
        let HostProtocolEnvelope::Response {
            id: response_id,
            payload,
            error,
            ..
        } = frame
        else {
            panic!("expected extension config response frame: {frame:?}");
        };
        assert_eq!(response_id, id);
        assert_eq!(payload.as_ref(), Some(&expected_payload));
        assert_eq!(error, &None);
    }

    fn assert_extension_package_event(
        frame: &HostProtocolEnvelope,
        phase: &str,
        version: Option<&str>,
        revision: Option<u64>,
    ) {
        let HostProtocolEnvelope::Event {
            method,
            payload: Some(payload),
            ..
        } = frame
        else {
            panic!("expected extension package event frame: {frame:?}");
        };
        assert_eq!(method, host_protocol::EXTENSION_PACKAGE_EVENT);
        assert_eq!(payload["phase"], phase);
        assert_eq!(payload["packageId"], "extension-1");
        match version {
            Some(version) => assert_eq!(payload["version"], version),
            None => assert!(payload.get("version").is_none()),
        }
        match revision {
            Some(revision) => assert_eq!(payload["revision"], revision),
            None => assert!(payload.get("revision").is_none()),
        }
    }

    fn assert_extension_package_response(
        frame: &HostProtocolEnvelope,
        id: &str,
        expected_payload: serde_json::Value,
    ) {
        let HostProtocolEnvelope::Response {
            id: response_id,
            payload,
            error,
            ..
        } = frame
        else {
            panic!("expected extension package response frame: {frame:?}");
        };
        assert_eq!(response_id, id);
        assert_eq!(payload.as_ref(), Some(&expected_payload));
        assert_eq!(error, &None);
    }

    fn assert_extension_package_list(
        frame: &HostProtocolEnvelope,
        id: &str,
        revision: u64,
        version: &str,
    ) {
        let HostProtocolEnvelope::Response {
            id: response_id,
            payload: Some(payload),
            error,
            ..
        } = frame
        else {
            panic!("expected extension package list response frame: {frame:?}");
        };
        assert_eq!(response_id, id);
        assert_eq!(error, &None);
        assert_eq!(payload["packages"][0]["packageId"], "extension-1");
        assert_eq!(payload["packages"][0]["manifest"]["version"], version);
        assert_eq!(payload["packages"][0]["revision"], revision);
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

    fn temp_runtime_layout(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "effect-desktop-runtime-layout-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("runtime layout dir");
        path
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

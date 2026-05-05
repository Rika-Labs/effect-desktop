//! Runtime child-process supervision.

mod platform;

use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{
    ffi::OsString,
    io::{self, BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, ExitStatus, Stdio},
    sync::mpsc::{self, Receiver, RecvTimeoutError, Sender},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tracing::{debug, warn};

const RUNTIME_READY_EVENT: &str = "runtime.ready";
const TERMINATION_GRACE: Duration = Duration::from_secs(5);
const TERMINATION_POLL_INTERVAL: Duration = Duration::from_millis(10);

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

pub(crate) struct Supervisor {
    events: Option<Receiver<RuntimeEvent>>,
    terminate: Sender<Termination>,
    lifecycle_thread: Option<JoinHandle<()>>,
    event_drain_thread: Option<JoinHandle<()>>,
}

impl Supervisor {
    pub(crate) fn spawn(config: RuntimeConfig) -> Result<Self> {
        let mut command = config.command();
        platform::configure_command(&mut command);

        let mut child = command.spawn().with_context(|| {
            format!("failed to spawn runtime executable {:?}", config.executable)
        })?;
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

        Ok(Self {
            events: Some(events),
            terminate,
            lifecycle_thread: Some(lifecycle_thread),
            event_drain_thread: None,
        })
    }

    pub(crate) fn events(&self) -> &Receiver<RuntimeEvent> {
        self.events
            .as_ref()
            .expect("runtime event receiver moved into post-ready drain")
    }

    fn start_post_ready_drain(&mut self) -> Result<()> {
        let events = self
            .events
            .take()
            .context("runtime event receiver already moved into post-ready drain")?;
        self.event_drain_thread = Some(spawn_event_drain(events));
        Ok(())
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        let _ = self.terminate.send(Termination::Terminate);
        join_thread(self.lifecycle_thread.take());
        join_thread(self.event_drain_thread.take());
    }
}

pub(crate) fn await_ready(supervisor: &mut Supervisor, timeout: Duration) -> Result<RuntimeReady> {
    let ready = await_ready_events(supervisor.events(), timeout)?;
    supervisor.start_post_ready_drain()?;
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

fn spawn_event_drain(events: Receiver<RuntimeEvent>) -> JoinHandle<()> {
    thread::spawn(move || {
        while let Ok(event) = events.recv() {
            trace_runtime_event(event);
        }
    })
}

fn trace_runtime_event(event: RuntimeEvent) {
    match event {
        RuntimeEvent::Started { pid } => {
            debug!(pid, "runtime child started");
        }
        RuntimeEvent::Stdout { line } => {
            debug!(line, "runtime stdout");
        }
        RuntimeEvent::Stderr { line } => {
            warn!(line, "runtime stderr");
        }
        RuntimeEvent::StdioError { stream, error } => {
            warn!(?stream, error, "runtime stdio error");
        }
        RuntimeEvent::LifecycleError { error } => {
            warn!(error, "runtime lifecycle error");
        }
        RuntimeEvent::Exited { status } => {
            debug!(%status, success = status.success(), "runtime exited");
        }
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
        await_ready_events, parse_runtime_ready_line, spawn_event_drain, RuntimeConfig,
        RuntimeEvent, RuntimeReady, RuntimeStream, Supervisor,
    };
    use std::{
        sync::mpsc::{self, Receiver},
        time::{Duration, Instant},
    };

    const EVENT_TIMEOUT: Duration = Duration::from_secs(5);

    #[test]
    fn supervisor_emits_started_stdio_and_exit_events() {
        let supervisor = Supervisor::spawn(RuntimeConfig::new("bun").args([
            "-e",
            "console.log('runtime stdout'); console.error('runtime stderr');",
        ]))
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
        ]))
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
    fn event_drain_consumes_post_ready_events_until_channel_closes() {
        let (events_tx, events_rx) = mpsc::channel();
        let drain_thread = spawn_event_drain(events_rx);

        events_tx
            .send(RuntimeEvent::Stdout {
                line: "after ready".to_string(),
            })
            .expect("post-ready stdout event should send");
        events_tx
            .send(RuntimeEvent::Stderr {
                line: "after ready stderr".to_string(),
            })
            .expect("post-ready stderr event should send");
        drop(events_tx);

        assert!(
            drain_thread.join().is_ok(),
            "event drain should exit when the event channel closes"
        );
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
}

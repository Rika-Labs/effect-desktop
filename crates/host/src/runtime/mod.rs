//! Runtime child-process supervision.

// Issue #30 defines the supervisor before issue #31 wires it into host startup.
#![allow(dead_code)]

mod platform;

use anyhow::{Context, Result};
use std::{
    ffi::OsString,
    io::{self, BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, ExitStatus, Stdio},
    sync::mpsc::{self, Receiver, RecvTimeoutError, Sender},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

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

    pub(crate) fn arg(mut self, arg: impl Into<OsString>) -> Self {
        self.args.push(arg.into());
        self
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
    events: Receiver<RuntimeEvent>,
    terminate: Sender<Termination>,
    lifecycle_thread: Option<JoinHandle<()>>,
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
            events,
            terminate,
            lifecycle_thread: Some(lifecycle_thread),
        })
    }

    pub(crate) fn events(&self) -> &Receiver<RuntimeEvent> {
        &self.events
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        let _ = self.terminate.send(Termination::Terminate);
        join_thread(self.lifecycle_thread.take());
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
    use super::{RuntimeConfig, RuntimeEvent, RuntimeStream, Supervisor};
    use std::{
        sync::mpsc::Receiver,
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

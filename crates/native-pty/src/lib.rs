use portable_pty::{
    native_pty_system, Child, CommandBuilder, MasterPty, PtySize as PortablePtySize,
};
use std::collections::BTreeMap;
use std::fmt;
use std::io::{Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;

pub type PtyResult<T> = Result<T, PtyError>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PtySize {
    pub rows: u16,
    pub cols: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PtyCommand {
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub cwd: Option<PathBuf>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PtyExitStatus {
    pub code: u32,
    pub signal: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PtyError {
    InvalidArgument {
        field: &'static str,
        reason: String,
        operation: &'static str,
    },
    FileNotFound {
        path: String,
        operation: &'static str,
    },
    PermissionDenied {
        resource: String,
        operation: &'static str,
    },
    ResourceBusy {
        resource: String,
        operation: &'static str,
    },
    InvalidState {
        current: &'static str,
        attempted: &'static str,
        operation: &'static str,
    },
    PanicInNativeCode {
        operation: &'static str,
    },
    Internal {
        message: String,
        operation: &'static str,
    },
}

pub struct NativePty {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
    writer: Option<Box<dyn Write + Send>>,
}

pub fn open(size: PtySize, command: PtyCommand) -> PtyResult<NativePty> {
    catch_pty_panic("Pty.open", || open_inner(size, command))?
}

impl NativePty {
    pub fn write(&mut self, bytes: &[u8]) -> PtyResult<usize> {
        catch_pty_panic("Pty.write", || {
            if bytes.is_empty() {
                return Err(PtyError::InvalidArgument {
                    field: "bytes",
                    reason: "must not be empty".to_string(),
                    operation: "Pty.write",
                });
            }

            let writer = self.writer.as_mut().ok_or(PtyError::InvalidState {
                current: "stdin-closed",
                attempted: "write",
                operation: "Pty.write",
            })?;
            writer
                .write(bytes)
                .map_err(|error| map_io_error(error, "Pty.write"))
        })?
    }

    pub fn close_stdin(&mut self) {
        self.writer.take();
    }

    pub fn read(&mut self, max_bytes: usize) -> PtyResult<Vec<u8>> {
        catch_pty_panic("Pty.read", || {
            if max_bytes == 0 {
                return Err(PtyError::InvalidArgument {
                    field: "maxBytes",
                    reason: "must be greater than zero".to_string(),
                    operation: "Pty.read",
                });
            }

            let mut bytes = vec![0; max_bytes];
            let read = self
                .reader
                .read(&mut bytes)
                .map_err(|error| map_io_error(error, "Pty.read"))?;
            bytes.truncate(read);
            Ok(bytes)
        })?
    }

    pub fn resize(&self, size: PtySize) -> PtyResult<()> {
        catch_pty_panic("Pty.resize", || {
            validate_size(&size, "Pty.resize")?;
            self.master
                .resize(portable_size(size))
                .map_err(|error| map_anyhow_error(error, "Pty.resize"))
        })?
    }

    pub fn try_wait(&mut self) -> PtyResult<Option<PtyExitStatus>> {
        catch_pty_panic("Pty.tryWait", || {
            self.child
                .try_wait()
                .map(|status| status.map(PtyExitStatus::from))
                .map_err(|error| map_io_error(error, "Pty.tryWait"))
        })?
    }

    pub fn wait(&mut self) -> PtyResult<PtyExitStatus> {
        catch_pty_panic("Pty.wait", || {
            self.child
                .wait()
                .map(PtyExitStatus::from)
                .map_err(|error| map_io_error(error, "Pty.wait"))
        })?
    }

    pub fn kill(&mut self) -> PtyResult<()> {
        catch_pty_panic("Pty.kill", || {
            self.child
                .kill()
                .map_err(|error| map_io_error(error, "Pty.kill"))
        })?
    }

    pub fn process_id(&self) -> Option<u32> {
        self.child.process_id()
    }
}

impl Drop for NativePty {
    fn drop(&mut self) {
        self.close_stdin();
        match self.child.try_wait() {
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => {
                // Drop cannot report typed errors, but the primitive still owns
                // best-effort child cleanup if callers forget to kill or wait.
                let _ = self.child.kill();
                let _ = self.child.wait();
            }
        }
    }
}

impl PtyCommand {
    pub fn new(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            env: BTreeMap::new(),
            cwd: None,
        }
    }

    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(key.into(), value.into());
        self
    }

    pub fn cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }
}

impl PtyError {
    pub fn tag(&self) -> &'static str {
        match self {
            PtyError::InvalidArgument { .. } => "InvalidArgument",
            PtyError::FileNotFound { .. } => "FileNotFound",
            PtyError::PermissionDenied { .. } => "PermissionDenied",
            PtyError::ResourceBusy { .. } => "ResourceBusy",
            PtyError::InvalidState { .. } => "InvalidState",
            PtyError::PanicInNativeCode { .. } => "PanicInNativeCode",
            PtyError::Internal { .. } => "Internal",
        }
    }

    pub fn operation(&self) -> &'static str {
        match self {
            PtyError::InvalidArgument { operation, .. }
            | PtyError::FileNotFound { operation, .. }
            | PtyError::PermissionDenied { operation, .. }
            | PtyError::ResourceBusy { operation, .. }
            | PtyError::InvalidState { operation, .. }
            | PtyError::PanicInNativeCode { operation }
            | PtyError::Internal { operation, .. } => operation,
        }
    }
}

impl fmt::Display for PtyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PtyError::InvalidArgument { field, reason, .. } => {
                write!(formatter, "invalid PTY argument {field}: {reason}")
            }
            PtyError::FileNotFound { path, .. } => write!(formatter, "PTY path not found: {path}"),
            PtyError::PermissionDenied { resource, .. } => {
                write!(formatter, "PTY permission denied: {resource}")
            }
            PtyError::ResourceBusy { resource, .. } => write!(formatter, "PTY busy: {resource}"),
            PtyError::InvalidState {
                current, attempted, ..
            } => write!(formatter, "invalid PTY state {current} for {attempted}"),
            PtyError::PanicInNativeCode { operation } => {
                write!(formatter, "native PTY panic during {operation}")
            }
            PtyError::Internal { message, .. } => {
                write!(formatter, "PTY internal error: {message}")
            }
        }
    }
}

impl std::error::Error for PtyError {}

impl From<portable_pty::ExitStatus> for PtyExitStatus {
    fn from(status: portable_pty::ExitStatus) -> Self {
        Self {
            code: status.exit_code(),
            signal: status.signal().map(str::to_string),
        }
    }
}

fn open_inner(size: PtySize, command: PtyCommand) -> PtyResult<NativePty> {
    validate_size(&size, "Pty.open")?;
    validate_command(&command)?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(portable_size(size))
        .map_err(|error| map_anyhow_error(error, "Pty.open"))?;
    let mut builder = CommandBuilder::new(&command.program);
    builder.args(&command.args);
    for (key, value) in command.env {
        builder.env(key, value);
    }
    if let Some(cwd) = command.cwd {
        builder.cwd(cwd);
    }

    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(|error| map_anyhow_error(error, "Pty.open"))?;
    drop(pair.slave);

    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            cleanup_spawned_child(child.as_mut());
            return Err(map_anyhow_error(error, "Pty.open"));
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            cleanup_spawned_child(child.as_mut());
            return Err(map_anyhow_error(error, "Pty.open"));
        }
    };

    Ok(NativePty {
        master: pair.master,
        child,
        reader,
        writer: Some(writer),
    })
}

fn cleanup_spawned_child(child: &mut dyn Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn validate_size(size: &PtySize, operation: &'static str) -> PtyResult<()> {
    if size.rows == 0 {
        return Err(PtyError::InvalidArgument {
            field: "rows",
            reason: "must be greater than zero".to_string(),
            operation,
        });
    }

    if size.cols == 0 {
        return Err(PtyError::InvalidArgument {
            field: "cols",
            reason: "must be greater than zero".to_string(),
            operation,
        });
    }

    Ok(())
}

fn validate_command(command: &PtyCommand) -> PtyResult<()> {
    if command.program.trim().is_empty() {
        return Err(PtyError::InvalidArgument {
            field: "program",
            reason: "must not be empty".to_string(),
            operation: "Pty.open",
        });
    }

    for key in command.env.keys() {
        if key.is_empty() {
            return Err(PtyError::InvalidArgument {
                field: "env",
                reason: "keys must not be empty".to_string(),
                operation: "Pty.open",
            });
        }
    }

    Ok(())
}

fn portable_size(size: PtySize) -> PortablePtySize {
    PortablePtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn catch_pty_panic<T>(
    operation: &'static str,
    f: impl FnOnce() -> PtyResult<T>,
) -> PtyResult<PtyResult<T>> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => Ok(result),
        Err(_) => Err(PtyError::PanicInNativeCode { operation }),
    }
}

fn map_io_error(error: std::io::Error, operation: &'static str) -> PtyError {
    match error.kind() {
        std::io::ErrorKind::NotFound => PtyError::FileNotFound {
            path: error.to_string(),
            operation,
        },
        std::io::ErrorKind::PermissionDenied => PtyError::PermissionDenied {
            resource: error.to_string(),
            operation,
        },
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => PtyError::ResourceBusy {
            resource: error.to_string(),
            operation,
        },
        _ => PtyError::Internal {
            message: error.to_string(),
            operation,
        },
    }
}

fn map_anyhow_error(error: anyhow::Error, operation: &'static str) -> PtyError {
    if let Some(io_error) = error.downcast_ref::<std::io::Error>() {
        return match io_error.kind() {
            std::io::ErrorKind::NotFound => PtyError::FileNotFound {
                path: error.to_string(),
                operation,
            },
            std::io::ErrorKind::PermissionDenied => PtyError::PermissionDenied {
                resource: error.to_string(),
                operation,
            },
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => {
                PtyError::ResourceBusy {
                    resource: error.to_string(),
                    operation,
                }
            }
            _ => PtyError::Internal {
                message: error.to_string(),
                operation,
            },
        };
    }

    let message = error.to_string();
    let lowercase_message = message.to_lowercase();
    if lowercase_message.contains("doesn't exist")
        || lowercase_message.contains("does not exist")
        || lowercase_message.contains("no viable candidates found")
        || lowercase_message.contains("no such file")
        || lowercase_message.contains("cannot find the file")
    {
        return PtyError::FileNotFound {
            path: message,
            operation,
        };
    }

    if lowercase_message.contains("not executable")
        || lowercase_message.contains("permission denied")
    {
        return PtyError::PermissionDenied {
            resource: message,
            operation,
        };
    }

    PtyError::Internal { message, operation }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::time::{Duration, Instant};

    #[test]
    fn rejects_empty_command_before_opening_pty() {
        let error = expect_open_error(open(PtySize { rows: 24, cols: 80 }, PtyCommand::new("")));

        assert_eq!(error.tag(), "InvalidArgument");
        assert_eq!(error.operation(), "Pty.open");
    }

    #[test]
    fn rejects_zero_rows_before_opening_pty() {
        let error = expect_open_error(open(PtySize { rows: 0, cols: 80 }, echo_command("hi")));

        assert_eq!(error.tag(), "InvalidArgument");
        assert_eq!(error.operation(), "Pty.open");
    }

    #[test]
    fn maps_missing_program_to_file_not_found() {
        let error = expect_open_error(open(
            PtySize { rows: 24, cols: 80 },
            PtyCommand::new("effect-desktop-definitely-missing-pty-command"),
        ));

        assert_eq!(error.tag(), "FileNotFound");
    }

    #[cfg(unix)]
    #[test]
    fn opens_pty_reads_output_and_waits_for_exit() {
        let pty = open(
            PtySize { rows: 24, cols: 80 },
            echo_command("native-pty-ok"),
        )
        .expect("open pty");

        let (mut pty, output) = read_until_contains(pty, "native-pty-ok");
        let status = pty.wait().expect("wait for child");

        assert!(output.contains("native-pty-ok"), "{output:?}");
        assert_eq!(status.code, 0);
        assert_eq!(status.signal, None);
    }

    #[cfg(unix)]
    #[test]
    fn write_sends_bytes_to_child_stdin() {
        let mut pty = open(PtySize { rows: 24, cols: 80 }, stdin_echo_command()).expect("open pty");

        pty.write(b"native-pty-stdin\r").expect("write stdin");
        let (mut pty, output) = read_until_contains(pty, "native-pty-stdin");
        pty.kill().expect("kill pty");
        let _ = pty.wait();

        assert!(output.contains("native-pty-stdin"), "{output:?}");
    }

    #[test]
    fn resize_accepts_valid_size() {
        let mut pty = open(PtySize { rows: 24, cols: 80 }, echo_command("resize")).expect("open");

        pty.resize(PtySize {
            rows: 30,
            cols: 100,
        })
        .expect("resize pty");
        pty.kill().expect("kill pty");
        let _ = pty.wait();
    }

    #[test]
    fn read_rejects_zero_max_bytes() {
        let mut pty = open(PtySize { rows: 24, cols: 80 }, echo_command("read")).expect("open");

        let error = pty.read(0).unwrap_err();
        pty.kill().expect("kill pty");
        let _ = pty.wait();

        assert_eq!(error.tag(), "InvalidArgument");
        assert_eq!(error.operation(), "Pty.read");
    }

    #[test]
    fn close_stdin_makes_later_write_an_invalid_state() {
        let mut pty = open(PtySize { rows: 24, cols: 80 }, stdin_echo_command()).expect("open");

        pty.close_stdin();
        let error = pty.write(b"late").unwrap_err();
        pty.kill().expect("kill pty");
        let _ = pty.wait();

        assert_eq!(error.tag(), "InvalidState");
        assert_eq!(error.operation(), "Pty.write");
    }

    #[cfg(unix)]
    #[test]
    fn dropping_handle_terminates_child_process() {
        let pty = open(
            PtySize { rows: 24, cols: 80 },
            PtyCommand::new("/bin/sh").arg("-c").arg("sleep 30"),
        )
        .expect("open pty");
        let pid = pty.process_id().expect("child pid");

        drop(pty);

        assert_child_exited(pid);
    }

    #[cfg(unix)]
    fn read_until_contains(mut pty: NativePty, needle: &'static str) -> (NativePty, String) {
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut output = Vec::new();
            while Instant::now() < deadline {
                let chunk = pty.read(1024).expect("read pty output");
                if chunk.is_empty() {
                    break;
                }
                output.extend_from_slice(&chunk);
                let text = String::from_utf8_lossy(&output).to_string();
                if text.contains(needle) {
                    let _ = sender.send((pty, text));
                    return;
                }
            }

            let _ = sender.send((pty, String::from_utf8_lossy(&output).to_string()));
        });

        receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("timed out waiting for PTY output")
    }

    fn expect_open_error(result: PtyResult<NativePty>) -> PtyError {
        match result {
            Ok(_) => panic!("expected PTY open to fail"),
            Err(error) => error,
        }
    }

    fn echo_command(message: &str) -> PtyCommand {
        if cfg!(windows) {
            PtyCommand::new("cmd")
                .arg("/C")
                .arg(format!("echo {message}"))
        } else {
            PtyCommand::new("/bin/sh")
                .arg("-c")
                .arg(format!("printf '%s\\n' {}", shell_quote(message)))
        }
    }

    fn stdin_echo_command() -> PtyCommand {
        if cfg!(windows) {
            PtyCommand::new("cmd").arg("/C").arg("more")
        } else {
            PtyCommand::new("/bin/sh").arg("-c").arg("cat")
        }
    }

    #[cfg(unix)]
    fn assert_child_exited(pid: u32) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let exited = std::process::Command::new("/bin/kill")
                .arg("-0")
                .arg(pid.to_string())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|status| !status.success())
                .unwrap_or(true);
            if exited {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        panic!("PTY child {pid} was still alive after drop");
    }

    #[cfg(unix)]
    fn shell_quote(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\\''"))
    }

    #[cfg(windows)]
    fn shell_quote(value: &str) -> String {
        value.to_string()
    }
}

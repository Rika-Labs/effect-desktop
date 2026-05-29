use portable_pty::{
    native_pty_system, Child, CommandBuilder, MasterPty, PtySize as PortablePtySize,
};
use std::collections::BTreeMap;
use std::fmt;
use std::io::{Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::time::{Duration, Instant};

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
    master: Option<Box<dyn MasterPty + Send>>,
    child: Box<dyn Child + Send + Sync>,
    reader: Option<Box<dyn Read + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    #[cfg(windows)]
    job: Option<PtyJob>,
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
                .write_all(bytes)
                .map(|()| bytes.len())
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

            let reader = self.reader.as_mut().ok_or(PtyError::InvalidState {
                current: "reader-taken",
                attempted: "read",
                operation: "Pty.read",
            })?;
            let mut bytes = vec![0; max_bytes];
            let read = reader
                .read(&mut bytes)
                .map_err(|error| map_io_error(error, "Pty.read"))?;
            bytes.truncate(read);
            Ok(bytes)
        })?
    }

    pub fn take_reader(&mut self) -> PtyResult<Box<dyn Read + Send>> {
        catch_pty_panic("Pty.takeReader", || {
            self.reader.take().ok_or(PtyError::InvalidState {
                current: "reader-taken",
                attempted: "take-reader",
                operation: "Pty.takeReader",
            })
        })?
    }

    pub fn resize(&self, size: PtySize) -> PtyResult<()> {
        catch_pty_panic("Pty.resize", || {
            validate_size(&size, "Pty.resize")?;
            self.master
                .as_ref()
                .ok_or(PtyError::InvalidState {
                    current: "pty-closed",
                    attempted: "resize",
                    operation: "Pty.resize",
                })?
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
        self.terminate_tree()
    }

    pub fn signal_tree(&mut self, signal: i32) -> PtyResult<()> {
        catch_pty_panic("Pty.signalTree", || self.signal_child_tree(signal))?
    }

    pub fn terminate_tree(&mut self) -> PtyResult<()> {
        catch_pty_panic("Pty.terminateTree", || {
            self.terminate_child_tree(TreeSignal::Terminate)
        })?
    }

    pub fn force_kill_tree(&mut self) -> PtyResult<()> {
        catch_pty_panic("Pty.forceKillTree", || {
            self.terminate_child_tree(TreeSignal::ForceKill)
        })?
    }

    pub fn wait_for_exit(&mut self, timeout: Duration) -> PtyResult<Option<PtyExitStatus>> {
        catch_pty_panic("Pty.waitForExit", || {
            let deadline = Instant::now() + timeout;
            loop {
                if let Some(status) = self.try_wait()? {
                    return Ok(Some(status));
                }
                if Instant::now() >= deadline {
                    return Ok(None);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        })?
    }

    pub fn close_tree(&mut self, graceful_shutdown: Duration) -> PtyResult<Option<PtyExitStatus>> {
        catch_pty_panic("Pty.closeTree", || {
            self.terminate_tree()?;
            if let Some(status) = self.wait_for_exit(graceful_shutdown)? {
                return Ok(Some(status));
            }

            self.force_kill_tree()?;
            self.wait_for_exit(graceful_shutdown)
        })?
    }

    pub fn process_id(&self) -> Option<u32> {
        self.child.process_id()
    }

    #[cfg(unix)]
    fn terminate_child_tree(&mut self, signal: TreeSignal) -> PtyResult<()> {
        let pgid = self.pty_process_group(signal.operation())?;
        let result = signal_process_group_or_child(
            self.child.as_mut(),
            pgid,
            signal.unix_signal(),
            signal.operation(),
        );
        if matches!(signal, TreeSignal::ForceKill) {
            self.close_pty_handles();
        }
        result
    }

    #[cfg(windows)]
    fn terminate_child_tree(&mut self, signal: TreeSignal) -> PtyResult<()> {
        let result = match &self.job {
            Some(job) => job.terminate(signal),
            None => self
                .child
                .kill()
                .map_err(|error| map_io_error(error, signal.operation())),
        };
        if matches!(signal, TreeSignal::ForceKill) {
            self.close_pty_handles();
        }
        result
    }

    #[cfg(unix)]
    fn signal_child_tree(&mut self, signal: i32) -> PtyResult<()> {
        let pgid = self.pty_process_group("Pty.signalTree")?;
        let result =
            signal_process_group_or_child(self.child.as_mut(), pgid, signal, "Pty.signalTree");
        if signal == libc::SIGKILL {
            self.close_pty_handles();
        }
        result
    }

    #[cfg(windows)]
    fn signal_child_tree(&mut self, signal: i32) -> PtyResult<()> {
        match signal {
            9 => self.force_kill_tree(),
            15 => self.terminate_tree(),
            _ => Err(PtyError::InvalidArgument {
                field: "signal",
                reason: "only SIGTERM and SIGKILL are supported on Windows".to_string(),
                operation: "Pty.signalTree",
            }),
        }
    }

    #[cfg(unix)]
    fn pty_process_group(&self, operation: &'static str) -> PtyResult<libc::pid_t> {
        match self
            .master
            .as_ref()
            .and_then(|master| master.process_group_leader())
        {
            Some(pgid) => Ok(pgid),
            None => child_pid(self.child.as_ref(), operation),
        }
    }

    fn close_pty_handles(&mut self) {
        self.close_stdin();
        self.reader.take();
        self.master.take();
    }
}

#[derive(Clone, Copy)]
enum TreeSignal {
    Terminate,
    ForceKill,
}

#[cfg(unix)]
fn terminate_child_tree(child: &mut dyn Child, signal: TreeSignal) -> PtyResult<()> {
    let pgid = child_pid(child, signal.operation())?;
    signal_process_group_or_child(child, pgid, signal.unix_signal(), signal.operation())
}

#[cfg(unix)]
fn child_pid(child: &dyn Child, operation: &'static str) -> PtyResult<libc::pid_t> {
    child
        .process_id()
        .ok_or(PtyError::InvalidState {
            current: "missing-process-id",
            attempted: operation,
            operation,
        })?
        .try_into()
        .map_err(|_| PtyError::InvalidState {
            current: "invalid-process-id",
            attempted: operation,
            operation,
        })
}

#[cfg(unix)]
fn signal_process_group_or_child(
    child: &mut dyn Child,
    pgid: libc::pid_t,
    signal: libc::c_int,
    operation: &'static str,
) -> PtyResult<()> {
    let result = unsafe { libc::kill(-pgid, signal) };
    if result == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return signal_child(child, signal, operation);
    }

    Err(map_io_error(error, operation))
}

#[cfg(unix)]
fn signal_child(
    child: &mut dyn Child,
    signal: libc::c_int,
    operation: &'static str,
) -> PtyResult<()> {
    if child
        .try_wait()
        .map_err(|error| map_io_error(error, operation))?
        .is_some()
    {
        return Ok(());
    }

    let pid = child_pid(child, operation)?;
    let result = unsafe { libc::kill(pid, signal) };
    if result == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }

    Err(map_io_error(error, operation))
}

#[cfg(unix)]
impl TreeSignal {
    fn unix_signal(self) -> libc::c_int {
        match self {
            TreeSignal::Terminate => libc::SIGTERM,
            TreeSignal::ForceKill => libc::SIGKILL,
        }
    }
}

impl TreeSignal {
    fn operation(self) -> &'static str {
        match self {
            TreeSignal::Terminate => "Pty.terminateTree",
            TreeSignal::ForceKill => "Pty.forceKillTree",
        }
    }
}

#[cfg(windows)]
struct PtyJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for PtyJob {}

#[cfg(windows)]
impl PtyJob {
    fn attach(child: &dyn Child) -> PtyResult<Self> {
        use std::{mem::size_of, ptr::null};
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let process = child.as_raw_handle().ok_or(PtyError::InvalidState {
            current: "missing-process-handle",
            attempted: "attach-job",
            operation: "Pty.open",
        })?;
        let job = unsafe { CreateJobObjectW(null(), null()) };
        if job.is_null() {
            return Err(map_io_error(std::io::Error::last_os_error(), "Pty.open"));
        }

        let guard = Self { handle: job };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let configured = unsafe {
            SetInformationJobObject(
                guard.handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(map_io_error(std::io::Error::last_os_error(), "Pty.open"));
        }

        let assigned = unsafe { AssignProcessToJobObject(guard.handle, process as HANDLE) };
        if assigned == 0 {
            return Err(map_io_error(std::io::Error::last_os_error(), "Pty.open"));
        }

        Ok(guard)
    }

    fn terminate(&self, signal: TreeSignal) -> PtyResult<()> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        let exit_code = match signal {
            TreeSignal::Terminate => 15,
            TreeSignal::ForceKill => 9,
        };
        let terminated = unsafe { TerminateJobObject(self.handle, exit_code) };
        if terminated == 0 {
            return Err(map_io_error(
                std::io::Error::last_os_error(),
                signal.operation(),
            ));
        }

        Ok(())
    }
}

#[cfg(windows)]
impl Drop for PtyJob {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;

        unsafe {
            CloseHandle(self.handle);
        }
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
                let _ = self.terminate_child_tree(TreeSignal::ForceKill);
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
    #[cfg(windows)]
    let job = match PtyJob::attach(child.as_ref()) {
        Ok(job) => job,
        Err(error) => {
            cleanup_spawned_child(child.as_mut());
            return Err(error);
        }
    };
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
        master: Some(pair.master),
        child,
        reader: Some(reader),
        writer: Some(writer),
        #[cfg(windows)]
        job: Some(job),
    })
}

fn cleanup_spawned_child(child: &mut dyn Child) {
    #[cfg(unix)]
    {
        let _ = terminate_child_tree(child, TreeSignal::ForceKill);
    }
    #[cfg(windows)]
    {
        let _ = child.kill();
    }
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
    #[test]
    fn terminate_tree_kills_shell_descendants() {
        let pty = open(
            PtySize { rows: 24, cols: 80 },
            PtyCommand::new("/bin/sh")
                .arg("-c")
                .arg("sleep 30 & printf '%s\\n' $!; wait"),
        )
        .expect("open pty");
        let child_pid = pty.process_id().expect("child pid");
        let (mut pty, output) = read_until_contains(pty, "\r\n");
        let grandchild_pid = parse_first_pid(&output);

        pty.terminate_tree().expect("terminate pty tree");
        let status = pty
            .wait_for_exit(Duration::from_secs(5))
            .expect("wait for child exit");

        assert!(status.is_some(), "direct PTY child did not exit");
        assert_child_exited(child_pid);
        assert_child_exited(grandchild_pid);
    }

    #[cfg(unix)]
    #[test]
    fn force_kill_tree_kills_shell_that_ignores_sigterm() {
        let pty = open(
            PtySize { rows: 24, cols: 80 },
            PtyCommand::new("/bin/sh")
                .arg("-c")
                .arg("trap '' TERM; (trap '' TERM; sleep 30) & printf '%s\\n' $!; while :; do sleep 1; done"),
        )
        .expect("open pty");
        let child_pid = pty.process_id().expect("child pid");
        let (mut pty, output) = read_until_contains(pty, "\r\n");
        let grandchild_pid = parse_first_pid(&output);

        pty.terminate_tree().expect("terminate pty tree");
        let graceful_status = pty
            .wait_for_exit(Duration::from_millis(100))
            .expect("wait for graceful exit");
        assert!(
            graceful_status.is_none(),
            "TERM-trapping PTY child exited before force kill"
        );

        pty.force_kill_tree().expect("force kill pty tree");
        let forced_status = pty
            .wait_for_exit(Duration::from_secs(5))
            .expect("wait for forced exit");

        assert!(forced_status.is_some(), "direct PTY child did not exit");
        assert_child_exited(child_pid);
        assert_child_exited(grandchild_pid);
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

    #[cfg(unix)]
    fn parse_first_pid(output: &str) -> u32 {
        output
            .split_whitespace()
            .find_map(|part| part.parse::<u32>().ok())
            .unwrap_or_else(|| panic!("expected pid in PTY output: {output:?}"))
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

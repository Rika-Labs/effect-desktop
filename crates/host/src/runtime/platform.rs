use std::{
    io,
    process::{Child, Command},
};

#[cfg(unix)]
pub(super) fn configure_command(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);

    #[cfg(target_os = "linux")]
    {
        // SAFETY: the closure only calls async-signal-safe libc functions before
        // exec: prctl, getppid, raise, and last_os_error on failure.
        unsafe {
            command.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
                    return Err(io::Error::last_os_error());
                }

                if libc::getppid() == 1 {
                    libc::raise(libc::SIGTERM);
                }

                Ok(())
            });
        }
    }
}

#[cfg(windows)]
pub(super) fn configure_command(_command: &mut Command) {}

#[cfg(not(any(unix, windows)))]
pub(super) fn configure_command(_command: &mut Command) {}

#[cfg(unix)]
pub(super) struct ChildGuard;

#[cfg(unix)]
impl ChildGuard {
    pub(super) fn attach(_child: &Child) -> io::Result<Self> {
        Ok(Self)
    }
}

#[cfg(unix)]
pub(super) fn release_child_guard(_guard: ChildGuard) {}

#[cfg(windows)]
pub(super) struct ChildGuard {
    job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl ChildGuard {
    pub(super) fn attach(child: &Child) -> io::Result<Self> {
        use std::{mem::size_of, os::windows::io::AsRawHandle, ptr::null};
        use windows_sys::Win32::{
            Foundation::HANDLE,
            System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
        };

        // SAFETY: null security attributes and null name request an unnamed Job
        // Object. A null handle is checked before use and closed by Drop.
        let job = unsafe { CreateJobObjectW(null(), null()) };
        if job.is_null() {
            return Err(io::Error::last_os_error());
        }

        let guard = Self { job };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;

        // SAFETY: `limits` is a valid JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        // buffer for the given information class, and `guard.job` is live.
        let configured = unsafe {
            SetInformationJobObject(
                guard.job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(io::Error::last_os_error());
        }

        // SAFETY: std::process::Child exposes a live process handle while the
        // child value is alive. The Job Object remains live in `guard`.
        let assigned =
            unsafe { AssignProcessToJobObject(guard.job, child.as_raw_handle() as HANDLE) };
        if assigned == 0 {
            return Err(io::Error::last_os_error());
        }

        Ok(guard)
    }
}

#[cfg(windows)]
impl Drop for ChildGuard {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;

        // SAFETY: `job` is a handle returned by CreateJobObjectW and is closed
        // exactly once by this Drop implementation.
        unsafe {
            CloseHandle(self.job);
        }
    }
}

#[cfg(windows)]
pub(super) fn release_child_guard(guard: ChildGuard) {
    drop(guard);
}

#[cfg(not(any(unix, windows)))]
pub(super) struct ChildGuard;

#[cfg(not(any(unix, windows)))]
impl ChildGuard {
    pub(super) fn attach(_child: &Child) -> io::Result<Self> {
        Ok(Self)
    }
}

#[cfg(not(any(unix, windows)))]
pub(super) fn release_child_guard(_guard: ChildGuard) {}

#[cfg(unix)]
pub(super) fn request_termination(child: &mut Child) -> io::Result<()> {
    send_signal_to_process_group(child, libc::SIGTERM)
}

#[cfg(unix)]
pub(super) fn force_termination(child: &mut Child) -> io::Result<()> {
    send_signal_to_process_group(child, libc::SIGKILL)
}

#[cfg(unix)]
pub(super) fn cleanup_process_tree_after_exit(child: &Child) -> io::Result<()> {
    send_signal_to_process_group(child, libc::SIGKILL)
}

#[cfg(unix)]
fn send_signal_to_process_group(child: &Child, signal: libc::c_int) -> io::Result<()> {
    let pid = libc::pid_t::try_from(child.id()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("runtime child pid {} does not fit pid_t", child.id()),
        )
    })?;
    let process_group = -pid;

    // SAFETY: `process_group` is the negative pgid for the child configured
    // with process_group(0); signal is one of SIGTERM or SIGKILL.
    let result = unsafe { libc::kill(process_group, signal) };
    if result == 0 {
        return Ok(());
    }

    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(error)
    }
}

#[cfg(not(unix))]
pub(super) fn request_termination(child: &mut Child) -> io::Result<()> {
    child.kill()
}

#[cfg(not(unix))]
pub(super) fn force_termination(child: &mut Child) -> io::Result<()> {
    child.kill()
}

#[cfg(not(unix))]
pub(super) fn cleanup_process_tree_after_exit(_child: &Child) -> io::Result<()> {
    Ok(())
}

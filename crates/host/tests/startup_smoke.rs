use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[test]
fn host_binary_emits_startup_event_and_exits_zero() {
    let output = Command::new(env!("CARGO_BIN_EXE_host"))
        .arg("--window-smoke-test")
        .output()
        .expect("host binary should execute");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let process_output = format!("{stdout}{stderr}");

    assert!(
        output.status.success(),
        "host exited with status {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        output.status.code()
    );

    assert!(
        process_output.contains("host started"),
        "process output did not contain startup message\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"host.started\""),
        "process output did not contain startup event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("crate=\"host\""),
        "process output did not contain crate field\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"runtime.ready\""),
        "process output did not contain runtime ready event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"host.window.opened\""),
        "process output did not contain window opened event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"host.webview.opened\""),
        "process output did not contain webview opened event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("source=\"app-protocol\""),
        "process output did not contain webview source field\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("url=\"app://localhost/\""),
        "process output did not contain webview app URL\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"host.window.exit_requested\""),
        "process output did not contain window exit event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("source=\"window-smoke-test\""),
        "process output did not contain smoke exit source\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );

    let version_field = format!("version=\"{}\"", env!("CARGO_PKG_VERSION"));
    assert!(
        process_output.contains(&version_field),
        "process output did not contain version field {version_field}\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );

    let ready_index = process_output
        .find("event=\"runtime.ready\"")
        .expect("runtime ready event should be present");
    let window_index = process_output
        .find("event=\"host.window.opened\"")
        .expect("window opened event should be present");
    assert!(
        ready_index < window_index,
        "window opened before runtime ready\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
}

#[test]
fn host_binary_verifies_resident_lifecycle_close_to_background() {
    let output = Command::new(env!("CARGO_BIN_EXE_host"))
        .arg("--resident-lifecycle-smoke-test")
        .output()
        .expect("host binary should execute resident lifecycle smoke");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let process_output = format!("{stdout}{stderr}");

    assert!(
        output.status.success(),
        "host exited with status {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        output.status.code()
    );
    assert!(
        process_output.contains("event=\"host.resident_lifecycle.smoke_verified\""),
        "process output did not contain resident lifecycle smoke event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("retained=true"),
        "process output did not prove the window was retained\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("visible=false"),
        "process output did not prove the window was hidden\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("source=\"window-smoke-test\""),
        "process output did not contain smoke exit source\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
}

#[test]
fn host_binary_verifies_app_quit_lifecycle_exit() {
    let output = Command::new(env!("CARGO_BIN_EXE_host"))
        .arg("--app-quit-smoke-test")
        .output()
        .expect("host binary should execute app quit smoke");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let process_output = format!("{stdout}{stderr}");

    assert!(
        output.status.success(),
        "host exited with status {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        output.status.code()
    );
    assert!(
        process_output.contains("event=\"host.app_lifecycle.quit_smoke_verified\""),
        "process output did not contain app quit smoke event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"host.window.exit_requested\""),
        "process output did not contain window exit event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("source=\"app-quit\""),
        "process output did not contain app quit exit source\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
}

#[test]
fn host_binary_verifies_app_focus_lifecycle_path() {
    let output = Command::new(env!("CARGO_BIN_EXE_host"))
        .arg("--app-focus-smoke-test")
        .output()
        .expect("host binary should execute app focus smoke");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let process_output = format!("{stdout}{stderr}");

    assert!(
        output.status.success(),
        "host exited with status {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        output.status.code()
    );
    assert!(
        process_output.contains("event=\"host.app_lifecycle.focus_smoke_verified\""),
        "process output did not contain app focus smoke event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"host.window.exit_requested\""),
        "process output did not contain window exit event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("source=\"window-smoke-test\""),
        "process output did not contain smoke exit source\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
}

#[test]
fn host_binary_verifies_app_restart_lifecycle_path() {
    let marker = unique_marker_path("app-restart-smoke");
    let output = Command::new(env!("CARGO_BIN_EXE_host"))
        .arg("--app-restart-smoke-test")
        .env("EFFECT_DESKTOP_APP_RESTART_SMOKE_MARKER", &marker)
        .output()
        .expect("host binary should execute app restart smoke");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let process_output = format!("{stdout}{stderr}");

    assert!(
        output.status.success(),
        "host exited with status {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        output.status.code()
    );
    assert!(
        process_output.contains("event=\"host.app_lifecycle.restart_smoke_verified\""),
        "process output did not contain app restart smoke event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"host.window.exit_requested\""),
        "process output did not contain window exit event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("source=\"app-quit\""),
        "process output did not contain app quit exit source\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        wait_for_marker(&marker),
        "restart child did not write marker at {}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        marker.display()
    );

    let _ = fs::remove_file(marker);
}

#[test]
fn host_binary_verifies_single_instance_lock_between_processes() {
    let lock_path = unique_lock_path("single-instance-lock-smoke");
    let primary = Command::new(env!("CARGO_BIN_EXE_host"))
        .arg("--single-instance-lock-smoke-test")
        .env("EFFECT_DESKTOP_SINGLE_INSTANCE_LOCK_PATH", &lock_path)
        .env("EFFECT_DESKTOP_SINGLE_INSTANCE_SMOKE_HOLD_MS", "1000")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("primary host binary should execute single-instance smoke");

    assert!(
        wait_for_nonempty_file(&lock_path),
        "primary did not write single-instance lock metadata at {}",
        lock_path.display()
    );

    let secondary_output = Command::new(env!("CARGO_BIN_EXE_host"))
        .arg("--single-instance-lock-smoke-test")
        .env("EFFECT_DESKTOP_SINGLE_INSTANCE_LOCK_PATH", &lock_path)
        .output()
        .expect("secondary host binary should execute single-instance smoke");
    let secondary_stdout = String::from_utf8_lossy(&secondary_output.stdout);
    let secondary_stderr = String::from_utf8_lossy(&secondary_output.stderr);
    let secondary_process_output = format!("{secondary_stdout}{secondary_stderr}");

    let primary_output = primary
        .wait_with_output()
        .expect("primary host binary should finish single-instance smoke");
    let primary_stdout = String::from_utf8_lossy(&primary_output.stdout);
    let primary_stderr = String::from_utf8_lossy(&primary_output.stderr);
    let primary_process_output = format!("{primary_stdout}{primary_stderr}");

    assert!(
        primary_output.status.success(),
        "primary host exited with status {:?}\nstdout:\n{primary_stdout}\nstderr:\n{primary_stderr}",
        primary_output.status.code()
    );
    assert!(
        secondary_output.status.success(),
        "secondary host exited with status {:?}\nstdout:\n{secondary_stdout}\nstderr:\n{secondary_stderr}",
        secondary_output.status.code()
    );
    assert!(
        primary_process_output.contains("event=\"host.app.single_instance_lock.smoke_verified\"")
            && primary_process_output.contains("acquired=true"),
        "primary output did not prove lock ownership\nstdout:\n{primary_stdout}\nstderr:\n{primary_stderr}"
    );
    assert!(
        secondary_process_output
            .contains("event=\"host.app.single_instance_lock.smoke_verified\"")
            && secondary_process_output.contains("acquired=false")
            && secondary_process_output.contains("primary_pid="),
        "secondary output did not prove primary ownership was observed\nstdout:\n{secondary_stdout}\nstderr:\n{secondary_stderr}"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn host_binary_verifies_system_appearance_on_main_thread() {
    let output = Command::new(env!("CARGO_BIN_EXE_host"))
        .arg("--system-appearance-smoke-test")
        .output()
        .expect("host binary should execute system appearance smoke");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let process_output = format!("{stdout}{stderr}");

    assert!(
        output.status.success(),
        "host exited with status {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        output.status.code()
    );
    assert!(
        process_output.contains("event=\"host.started\""),
        "process output did not contain startup event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("event=\"host.system_appearance.smoke_verified\""),
        "process output did not contain system appearance smoke event\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        process_output.contains("appearance="),
        "process output did not include appearance snapshot\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        !process_output.contains("event=\"runtime.ready\""),
        "system appearance smoke should not start the renderer runtime\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
}

fn unique_lock_path(name: &str) -> std::path::PathBuf {
    unique_temp_path(name, "lock")
}

fn unique_marker_path(name: &str) -> std::path::PathBuf {
    unique_temp_path(name, "marker")
}

fn unique_temp_path(name: &str, extension: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after Unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "effect-desktop-{name}-{}-{nanos}.{extension}",
        std::process::id(),
    ))
}

fn wait_for_marker(path: &Path) -> bool {
    for _ in 0..40 {
        if path.is_file() {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    false
}

fn wait_for_nonempty_file(path: &Path) -> bool {
    for _ in 0..40 {
        if fs::read_to_string(path)
            .map(|contents| !contents.trim().is_empty())
            .unwrap_or(false)
        {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    false
}

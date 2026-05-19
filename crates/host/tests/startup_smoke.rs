use std::process::Command;

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

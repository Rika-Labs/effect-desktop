mod assets;
mod csp;
mod html_csp;
mod linux;
mod macos;
mod methods;
mod runtime;
mod scheme;
mod transport;
mod webview;
mod window;
mod windows;

use anyhow::{bail, Result};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tracing::info;
use window::RunMode;

const HOST_STARTED_EVENT: &str = "host.started";
const RUNTIME_READY_TIMEOUT: Duration = Duration::from_secs(10);
const HOST_PROTOCOL_STDIO_ARG: &str = "--host-protocol-stdio";
const WINDOW_SMOKE_TEST_ARG: &str = "--window-smoke-test";
const WINDOW_SMOKE_TEST_ENV: &str = "EFFECT_DESKTOP_WINDOW_SMOKE_TEST";
const STARTUP_WINDOWS_ENV: &str = "EFFECT_DESKTOP_STARTUP_WINDOWS";
const WINDOW_SMOKE_TEST_STARTUP_WINDOWS: &str =
    r#"{"smoke":{"title":"Effect Desktop Smoke Test","width":800,"height":600}}"#;
const SOURCE_RUNTIME_ENTRY: &str = "src/runtime/main.ts";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct StartupEvent {
    crate_name: &'static str,
    version: &'static str,
}

fn startup_event() -> StartupEvent {
    StartupEvent {
        crate_name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
    }
}

fn main() -> Result<()> {
    let run_mode = parse_run_mode(std::env::args())?;
    if matches!(run_mode, RunMode::HostProtocolStdio) {
        return serve_host_protocol_stdio();
    }

    tracing_subscriber::fmt()
        .with_ansi(false)
        .try_init()
        .map_err(|error| anyhow::anyhow!("failed to initialize tracing subscriber: {error}"))?;

    let event = startup_event();
    info!(
        event = HOST_STARTED_EVENT,
        crate = event.crate_name,
        version = event.version,
        "host started"
    );

    let runtime_profile = runtime::RuntimeProfile::from_env()?;
    let runtime_policy = runtime::RestartPolicy::for_profile(runtime_profile);
    let window_methods = window::WindowMethodPort::new();
    let method_router = methods::HostMethodRouter::new(Arc::new(window_methods.clone()));
    let mut runtime_supervisor =
        runtime::Supervisor::spawn(runtime_config(run_mode)?, runtime_policy, method_router)?;
    let runtime_ready = runtime::await_ready(&mut runtime_supervisor, RUNTIME_READY_TIMEOUT)?;
    info!(
        event = "runtime.ready",
        version = runtime_ready.version(),
        "runtime ready"
    );

    window::run_main_window(run_mode, window_methods)
}

fn serve_host_protocol_stdio() -> Result<()> {
    let method_router = methods::HostMethodRouter::new(Arc::new(window::WindowMethodPort::new()));
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    runtime::serve_framed_host_requests(stdin.lock(), stdout, &method_router)
}

fn runtime_config(run_mode: RunMode) -> Result<runtime::RuntimeConfig> {
    if let Some(config) = packaged_runtime_config()? {
        return Ok(with_run_mode_env(config, run_mode));
    }

    let core_package_dir = resolve_source_runtime_cwd()?;

    let config = runtime::RuntimeConfig::new("bun")
        .args([SOURCE_RUNTIME_ENTRY])
        .cwd(core_package_dir);

    Ok(with_run_mode_env(config, run_mode))
}

fn packaged_runtime_config() -> Result<Option<runtime::RuntimeConfig>> {
    let current_exe = std::env::current_exe().map_err(|error| {
        anyhow::anyhow!("failed to read current executable while resolving runtime: {error}")
    })?;
    packaged_runtime_config_for_exe(&current_exe)
}

fn packaged_runtime_config_for_exe(current_exe: &Path) -> Result<Option<runtime::RuntimeConfig>> {
    let Some(manifest_path) = runtime::manifest_path_for_exe(current_exe) else {
        return Ok(None);
    };
    if !manifest_path.is_file() {
        bail!(
            "packaged runtime manifest is missing at {}",
            manifest_path.display()
        );
    }
    runtime::RuntimeConfig::from_manifest_path(&manifest_path).map(Some)
}

fn with_run_mode_env(config: runtime::RuntimeConfig, run_mode: RunMode) -> runtime::RuntimeConfig {
    if matches!(run_mode, RunMode::WindowSmokeTest) {
        config
            .env(WINDOW_SMOKE_TEST_ENV, "1")
            .env(STARTUP_WINDOWS_ENV, WINDOW_SMOKE_TEST_STARTUP_WINDOWS)
    } else {
        config
    }
}

fn resolve_source_runtime_cwd() -> Result<PathBuf> {
    let mut anchors = vec![std::env::current_dir().map_err(|error| {
        anyhow::anyhow!("failed to read current directory while resolving runtime: {error}")
    })?];

    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            anchors.push(parent.to_path_buf());
        }
    }

    resolve_source_runtime_cwd_from_anchors(anchors)
}

fn resolve_source_runtime_cwd_from_anchors(
    anchors: impl IntoIterator<Item = PathBuf>,
) -> Result<PathBuf> {
    for anchor in anchors {
        for candidate in anchor.ancestors() {
            let core_package_dir = candidate.join("packages").join("core");
            let runtime_entry = core_package_dir.join(SOURCE_RUNTIME_ENTRY);
            if runtime_entry.is_file() {
                return Ok(core_package_dir);
            }
        }
    }

    bail!("failed to locate source runtime entry packages/core/{SOURCE_RUNTIME_ENTRY}")
}

fn parse_run_mode(args: impl IntoIterator<Item = String>) -> Result<RunMode> {
    let mut run_mode = RunMode::Interactive;

    for arg in args.into_iter().skip(1) {
        match arg.as_str() {
            HOST_PROTOCOL_STDIO_ARG => run_mode = RunMode::HostProtocolStdio,
            WINDOW_SMOKE_TEST_ARG => run_mode = RunMode::WindowSmokeTest,
            unknown => bail!("unknown host argument: {unknown}"),
        }
    }

    Ok(run_mode)
}

#[cfg(test)]
mod tests {
    use super::{
        packaged_runtime_config_for_exe, parse_run_mode, resolve_source_runtime_cwd_from_anchors,
        runtime_config, startup_event, HOST_PROTOCOL_STDIO_ARG, HOST_STARTED_EVENT,
        SOURCE_RUNTIME_ENTRY, STARTUP_WINDOWS_ENV, WINDOW_SMOKE_TEST_ARG, WINDOW_SMOKE_TEST_ENV,
    };
    use crate::window::RunMode;
    use std::path::PathBuf;

    #[test]
    fn startup_event_identifies_host_binary() {
        let event = startup_event();

        assert_eq!(HOST_STARTED_EVENT, "host.started");
        assert_eq!(event.crate_name, "host");
        assert_eq!(event.version, "0.0.0");
    }

    #[test]
    fn default_run_mode_is_interactive() {
        assert_eq!(
            parse_run_mode(["host".to_string()]).expect("run mode should parse"),
            RunMode::Interactive
        );
    }

    #[test]
    fn window_smoke_test_arg_selects_smoke_mode() {
        assert_eq!(
            parse_run_mode(["host".to_string(), WINDOW_SMOKE_TEST_ARG.to_string()])
                .expect("run mode should parse"),
            RunMode::WindowSmokeTest
        );
    }

    #[test]
    fn host_protocol_stdio_arg_selects_protocol_stdio_mode() {
        assert_eq!(
            parse_run_mode(["host".to_string(), HOST_PROTOCOL_STDIO_ARG.to_string()])
                .expect("run mode should parse"),
            RunMode::HostProtocolStdio
        );
    }

    #[test]
    fn unknown_arg_is_an_error() {
        let error = parse_run_mode(["host".to_string(), "--unknown".to_string()])
            .expect_err("unknown arg should fail");

        assert_eq!(error.to_string(), "unknown host argument: --unknown");
    }

    #[test]
    fn runtime_config_points_at_core_runtime_entry() {
        let config = runtime_config(RunMode::Interactive).expect("runtime config should resolve");
        let config_debug = format!("{config:?}");

        assert!(
            config_debug.contains("packages")
                && config_debug.contains("core")
                && config_debug.contains(SOURCE_RUNTIME_ENTRY),
            "runtime config should target the core runtime entry: {config_debug}"
        );
    }

    #[test]
    fn window_smoke_mode_marks_runtime_environment() {
        let config_debug = format!(
            "{:?}",
            runtime_config(RunMode::WindowSmokeTest).expect("runtime config should resolve")
        );

        assert!(
            config_debug.contains(WINDOW_SMOKE_TEST_ENV) && config_debug.contains("\"1\""),
            "window smoke runtime config should set {WINDOW_SMOKE_TEST_ENV}: {config_debug}"
        );
        assert!(
            config_debug.contains(STARTUP_WINDOWS_ENV)
                && config_debug.contains("Effect Desktop Smoke Test"),
            "window smoke runtime config should declare startup windows: {config_debug}"
        );
    }

    #[test]
    fn source_runtime_resolver_anchors_from_nested_directories() {
        let core_package_dir =
            resolve_source_runtime_cwd_from_anchors([PathBuf::from(env!("CARGO_MANIFEST_DIR"))])
                .expect("source runtime should resolve from crate directory");

        assert!(core_package_dir.join(SOURCE_RUNTIME_ENTRY).is_file());
    }

    #[test]
    fn packaged_runtime_config_fails_when_package_shaped_manifest_is_missing() {
        let error =
            packaged_runtime_config_for_exe(PathBuf::from("/app/layout/native/host").as_path())
                .expect_err("missing packaged manifest should fail");

        assert!(error
            .to_string()
            .contains("packaged runtime manifest is missing"));
    }

    #[test]
    fn packaged_runtime_config_ignores_source_shaped_executables() {
        let config =
            packaged_runtime_config_for_exe(PathBuf::from("/repo/target/debug/host").as_path())
                .expect("source-shaped executable should not fail");

        assert!(config.is_none());
    }
}

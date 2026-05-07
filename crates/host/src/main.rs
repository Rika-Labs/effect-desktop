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
use std::{path::PathBuf, sync::Arc, time::Duration};
use tracing::info;
use window::RunMode;

const HOST_STARTED_EVENT: &str = "host.started";
const RUNTIME_READY_TIMEOUT: Duration = Duration::from_secs(10);
const WINDOW_SMOKE_TEST_ARG: &str = "--window-smoke-test";
const WINDOW_SMOKE_TEST_ENV: &str = "EFFECT_DESKTOP_WINDOW_SMOKE_TEST";

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
        runtime::Supervisor::spawn(runtime_config(run_mode), runtime_policy, method_router)?;
    let runtime_ready = runtime::await_ready(&mut runtime_supervisor, RUNTIME_READY_TIMEOUT)?;
    info!(
        event = "runtime.ready",
        version = runtime_ready.version(),
        "runtime ready"
    );

    window::run_main_window(run_mode, window_methods)
}

fn runtime_config(run_mode: RunMode) -> runtime::RuntimeConfig {
    let core_package_dir = PathBuf::from("../../packages/core");

    let config = runtime::RuntimeConfig::new("bun")
        .args(["src/runtime/main.ts"])
        .cwd(core_package_dir);

    if matches!(run_mode, RunMode::WindowSmokeTest) {
        config.env(WINDOW_SMOKE_TEST_ENV, "1")
    } else {
        config
    }
}

fn parse_run_mode(args: impl IntoIterator<Item = String>) -> Result<RunMode> {
    let mut run_mode = RunMode::Interactive;

    for arg in args.into_iter().skip(1) {
        match arg.as_str() {
            WINDOW_SMOKE_TEST_ARG => run_mode = RunMode::WindowSmokeTest,
            unknown => bail!("unknown host argument: {unknown}"),
        }
    }

    Ok(run_mode)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_run_mode, runtime_config, startup_event, HOST_STARTED_EVENT, WINDOW_SMOKE_TEST_ARG,
        WINDOW_SMOKE_TEST_ENV,
    };
    use crate::window::RunMode;

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
    fn unknown_arg_is_an_error() {
        let error = parse_run_mode(["host".to_string(), "--unknown".to_string()])
            .expect_err("unknown arg should fail");

        assert_eq!(error.to_string(), "unknown host argument: --unknown");
    }

    #[test]
    fn runtime_config_points_at_core_runtime_entry() {
        let config = runtime_config(RunMode::Interactive);
        let config_debug = format!("{config:?}");

        assert!(
            config_debug.contains("packages")
                && config_debug.contains("core")
                && config_debug.contains("src/runtime/main.ts"),
            "runtime config should target the core runtime entry: {config_debug}"
        );
    }

    #[test]
    fn window_smoke_mode_marks_runtime_environment() {
        let config_debug = format!("{:?}", runtime_config(RunMode::WindowSmokeTest));

        assert!(
            config_debug.contains(WINDOW_SMOKE_TEST_ENV) && config_debug.contains("\"1\""),
            "window smoke runtime config should set {WINDOW_SMOKE_TEST_ENV}: {config_debug}"
        );
    }
}

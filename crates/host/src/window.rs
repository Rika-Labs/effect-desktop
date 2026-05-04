use anyhow::{Context, Result};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use tracing::info;

const WINDOW_TITLE: &str = "Effect Desktop";
const WINDOW_WIDTH: f64 = 960.0;
const WINDOW_HEIGHT: f64 = 640.0;
const WINDOW_OPENED_EVENT: &str = "host.window.opened";
const WINDOW_EXIT_REQUESTED_EVENT: &str = "host.window.exit_requested";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RunMode {
    Interactive,
    WindowSmokeTest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HostEvent {
    SmokeExitRequested,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowLifecycleEvent {
    CloseRequested,
    SmokeExitRequested,
    Other,
}

pub(crate) fn run_main_window(mode: RunMode) -> Result<()> {
    let mut event_loop_builder = EventLoopBuilder::<HostEvent>::with_user_event();
    let event_loop = event_loop_builder.build();
    let proxy = event_loop.create_proxy();
    let _window = WindowBuilder::new()
        .with_title(WINDOW_TITLE)
        .with_inner_size(LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT))
        .build(&event_loop)
        .context("failed to build host window")?;

    info!(
        event = WINDOW_OPENED_EVENT,
        title = WINDOW_TITLE,
        width = WINDOW_WIDTH,
        height = WINDOW_HEIGHT,
        smoke = matches!(mode, RunMode::WindowSmokeTest),
        "host window opened"
    );

    if matches!(mode, RunMode::WindowSmokeTest) {
        proxy
            .send_event(HostEvent::SmokeExitRequested)
            .context("failed to request host window smoke-test exit")?;
    }

    event_loop.run(move |event, _, control_flow| {
        *control_flow = control_flow_for_lifecycle_event(classify_event(&event));
    });
}

fn classify_event(event: &Event<'_, HostEvent>) -> WindowLifecycleEvent {
    match event {
        Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } => WindowLifecycleEvent::CloseRequested,
        Event::UserEvent(HostEvent::SmokeExitRequested) => WindowLifecycleEvent::SmokeExitRequested,
        _ => WindowLifecycleEvent::Other,
    }
}

fn control_flow_for_lifecycle_event(event: WindowLifecycleEvent) -> ControlFlow {
    match event {
        WindowLifecycleEvent::CloseRequested => {
            info!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "close-requested",
                "host window exit requested"
            );
            ControlFlow::Exit
        }
        WindowLifecycleEvent::SmokeExitRequested => {
            info!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "window-smoke-test",
                "host window exit requested"
            );
            ControlFlow::Exit
        }
        WindowLifecycleEvent::Other => ControlFlow::Wait,
    }
}

#[cfg(test)]
mod tests {
    use super::{control_flow_for_lifecycle_event, RunMode, WindowLifecycleEvent};
    use tao::event_loop::ControlFlow;

    #[test]
    fn close_requested_exits_with_zero_status() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::CloseRequested),
            ControlFlow::Exit
        );
    }

    #[test]
    fn smoke_exit_requested_exits_with_zero_status() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::SmokeExitRequested),
            ControlFlow::Exit
        );
    }

    #[test]
    fn unrelated_events_wait_without_spinning() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::Other),
            ControlFlow::Wait
        );
    }

    #[test]
    fn run_modes_are_distinct() {
        assert_ne!(RunMode::Interactive, RunMode::WindowSmokeTest);
    }
}

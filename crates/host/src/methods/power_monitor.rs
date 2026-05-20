#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolEnvelope, HostProtocolError, PowerMonitorIsSupportedPayload,
    PowerMonitorSupportedPayload,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{to_value, Value};
use std::sync::mpsc::Sender;

pub(crate) fn is_supported(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let _input = decode_payload::<PowerMonitorIsSupportedPayload>(
        payload,
        host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
    )?;
    encode_payload(
        power_monitor_support(),
        host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
    )
}

pub(crate) fn install_runtime_event_sender(
    sender: Sender<HostProtocolEnvelope>,
) -> Result<(), HostProtocolError> {
    platform::install_runtime_event_sender(sender)
}

pub(crate) fn clear_runtime_event_sender() -> Result<(), HostProtocolError> {
    platform::clear_runtime_event_sender()
}

#[cfg(target_os = "macos")]
fn power_monitor_support() -> PowerMonitorSupportedPayload {
    PowerMonitorSupportedPayload::supported()
}

#[cfg(not(target_os = "macos"))]
fn power_monitor_support() -> PowerMonitorSupportedPayload {
    PowerMonitorSupportedPayload::unsupported()
}

fn decode_payload<T: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    let payload = payload
        .ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))?;
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode power monitor payload: {error}"),
            operation,
        )
    })
}

#[cfg(any(test, target_os = "macos"))]
fn event_frame<T: Serialize>(
    method: &'static str,
    payload: T,
) -> Result<HostProtocolEnvelope, HostProtocolError> {
    Ok(HostProtocolEnvelope::Event {
        method: method.to_string(),
        timestamp: timestamp_millis(method)?,
        trace_id: "host-power-monitor".to_string(),
        window_id: None,
        payload: Some(to_value(payload).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode power monitor event payload: {error}"),
                method,
            )
        })?),
    })
}

#[cfg(any(test, target_os = "macos"))]
fn send_event<T: Serialize>(
    sender: &Sender<HostProtocolEnvelope>,
    method: &'static str,
    payload: T,
) {
    match event_frame(method, payload) {
        Ok(frame) => {
            if sender.send(frame).is_err() {
                tracing::debug!(
                    method,
                    "dropped power monitor event after runtime disconnect"
                );
            }
        }
        Err(error) => {
            tracing::warn!(method, error = ?error, "failed to encode power monitor event");
        }
    }
}

#[cfg(any(test, target_os = "macos"))]
fn timestamp_millis(operation: &'static str) -> Result<u64, HostProtocolError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("system time is before Unix epoch: {error}"),
                operation,
            )
        })
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{send_event, HostProtocolEnvelope, HostProtocolError};
    use block2::RcBlock;
    use host_protocol::{
        PowerMonitorReasonEventPayload, PowerMonitorSourceChangedEventPayload,
        PowerMonitorSourcePayload,
    };
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceSessionDidBecomeActiveNotification,
        NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceWillPowerOffNotification,
        NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSNotification, NSObjectProtocol};
    use std::{
        process::Command,
        ptr::NonNull,
        sync::{
            mpsc::{self, Sender},
            LazyLock, Mutex,
        },
        thread::{self, JoinHandle},
        time::Duration,
    };

    static POWER_MONITOR_STATE: LazyLock<Mutex<Option<MacosPowerMonitorState>>> =
        LazyLock::new(|| Mutex::new(None));

    struct MacosPowerMonitorState {
        observers: Vec<MacosObserver>,
        poller: Option<PowerSourcePoller>,
    }

    struct MacosObserver(Retained<objc2::runtime::ProtocolObject<dyn NSObjectProtocol>>);

    // SAFETY: The retained observer token is only retained so the runtime can
    // unregister it with NSNotificationCenter during disconnect. The token is
    // not messaged concurrently or exposed outside this module.
    unsafe impl Send for MacosObserver {}

    struct PowerSourcePoller {
        stop: Sender<()>,
        handle: JoinHandle<()>,
    }

    pub(crate) fn install_runtime_event_sender(
        sender: Sender<HostProtocolEnvelope>,
    ) -> Result<(), HostProtocolError> {
        clear_runtime_event_sender()?;
        let observers = install_workspace_observers(sender.clone());
        let poller = Some(start_power_source_poller(sender));
        *POWER_MONITOR_STATE.lock().map_err(|_| {
            HostProtocolError::internal(
                "power monitor state lock poisoned",
                host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
            )
        })? = Some(MacosPowerMonitorState { observers, poller });
        Ok(())
    }

    pub(crate) fn clear_runtime_event_sender() -> Result<(), HostProtocolError> {
        let Some(mut state) = POWER_MONITOR_STATE
            .lock()
            .map_err(|_| {
                HostProtocolError::internal(
                    "power monitor state lock poisoned",
                    host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
                )
            })?
            .take()
        else {
            return Ok(());
        };

        if let Some(poller) = state.poller.take() {
            let _ = poller.stop.send(());
            let _ = poller.handle.join();
        }

        let workspace = NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();
        for observer in state.observers {
            let observer_protocol: &objc2::runtime::ProtocolObject<dyn NSObjectProtocol> =
                observer.0.as_ref();
            let observer_object: &objc2::runtime::AnyObject = observer_protocol.as_ref();
            // SAFETY: Observer tokens were returned by this notification center
            // during installation and are only used here for unregistering.
            unsafe {
                center.removeObserver(observer_object);
            }
        }
        Ok(())
    }

    fn install_workspace_observers(sender: Sender<HostProtocolEnvelope>) -> Vec<MacosObserver> {
        let workspace = NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();
        // SAFETY: These AppKit notification-name statics are process-lifetime
        // constants exported by AppKit.
        let registrations = unsafe {
            [
                (
                    NSWorkspaceWillSleepNotification,
                    host_protocol::POWER_MONITOR_SUSPEND_EVENT,
                    "sleep",
                ),
                (
                    NSWorkspaceDidWakeNotification,
                    host_protocol::POWER_MONITOR_RESUME_EVENT,
                    "wake",
                ),
                (
                    NSWorkspaceWillPowerOffNotification,
                    host_protocol::POWER_MONITOR_SHUTDOWN_EVENT,
                    "power-off",
                ),
                (
                    NSWorkspaceSessionDidResignActiveNotification,
                    host_protocol::POWER_MONITOR_LOCK_SCREEN_EVENT,
                    "session-inactive",
                ),
                (
                    NSWorkspaceSessionDidBecomeActiveNotification,
                    host_protocol::POWER_MONITOR_UNLOCK_SCREEN_EVENT,
                    "session-active",
                ),
            ]
        };

        let mut observers = Vec::new();
        for (name, method, reason) in registrations {
            let event_sender = sender.clone();
            let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                send_event(
                    &event_sender,
                    method,
                    PowerMonitorReasonEventPayload::new(Some(reason.to_string())),
                );
            });
            // SAFETY: The notification name is an NSWorkspace notification.
            // The block ignores the notification object and emits a pure typed
            // host-protocol event into the runtime event channel.
            let observer = unsafe {
                center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
            };
            observers.push(MacosObserver(observer));
        }
        observers
    }

    fn start_power_source_poller(sender: Sender<HostProtocolEnvelope>) -> PowerSourcePoller {
        let (stop, stop_rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let mut last_source = read_power_source();
            emit_power_source(&sender, last_source);
            loop {
                if stop_rx.recv_timeout(Duration::from_secs(30)).is_ok() {
                    break;
                }
                let next = read_power_source();
                if next != last_source {
                    last_source = next;
                    emit_power_source(&sender, next);
                }
            }
        });
        PowerSourcePoller { stop, handle }
    }

    fn emit_power_source(sender: &Sender<HostProtocolEnvelope>, source: PowerMonitorSourcePayload) {
        send_event(
            sender,
            host_protocol::POWER_MONITOR_POWER_SOURCE_CHANGED_EVENT,
            PowerMonitorSourceChangedEventPayload::new(source),
        );
    }

    fn read_power_source() -> PowerMonitorSourcePayload {
        let Ok(output) = Command::new("pmset").args(["-g", "ps"]).output() else {
            return PowerMonitorSourcePayload::Unknown;
        };
        if !output.status.success() {
            return PowerMonitorSourcePayload::Unknown;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("AC Power") {
            PowerMonitorSourcePayload::Ac
        } else if stdout.contains("Battery Power") {
            PowerMonitorSourcePayload::Battery
        } else {
            PowerMonitorSourcePayload::Unknown
        }
    }

    #[cfg(test)]
    pub(crate) fn emit_test_event(
        sender: &Sender<HostProtocolEnvelope>,
        method: &'static str,
        reason: Option<&str>,
    ) {
        send_event(
            sender,
            method,
            PowerMonitorReasonEventPayload::new(reason.map(str::to_string)),
        );
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{HostProtocolEnvelope, HostProtocolError};
    use std::sync::mpsc::Sender;

    pub(crate) fn install_runtime_event_sender(
        _sender: Sender<HostProtocolEnvelope>,
    ) -> Result<(), HostProtocolError> {
        Ok(())
    }

    pub(crate) fn clear_runtime_event_sender() -> Result<(), HostProtocolError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::is_supported;
    #[cfg(target_os = "macos")]
    use super::{clear_runtime_event_sender, install_runtime_event_sender};
    #[cfg(target_os = "macos")]
    use host_protocol::HostProtocolEnvelope;
    use serde_json::json;

    #[test]
    fn power_monitor_support_reports_platform_truth_for_known_methods() {
        let payload = is_supported(Some(json!({ "method": "onSuspend" })))
            .expect("support query should return payload");
        assert_eq!(
            payload,
            Some(json!({ "supported": cfg!(target_os = "macos") }))
        );

        let payload = is_supported(Some(json!({ "method": "onLockScreen" })))
            .expect("lock support query should return payload");
        assert_eq!(
            payload,
            Some(json!({ "supported": cfg!(target_os = "macos") }))
        );
    }

    #[test]
    fn power_monitor_support_rejects_unknown_methods() {
        let error = is_supported(Some(json!({ "method": "onDisplayOff" })))
            .expect_err("unknown method should reject");
        assert_eq!(
            error,
            host_protocol::HostProtocolError::invalid_argument(
                "payload",
                "unknown variant `onDisplayOff`, expected one of `onSuspend`, `onResume`, `onShutdown`, `onLockScreen`, `onUnlockScreen`, `onPowerSourceChanged`",
                host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
            )
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn power_monitor_macos_event_sender_emits_typed_events() {
        let (sender, receiver) = std::sync::mpsc::channel::<HostProtocolEnvelope>();
        super::platform::emit_test_event(
            &sender,
            host_protocol::POWER_MONITOR_SUSPEND_EVENT,
            Some("sleep"),
        );

        let event = receiver.recv().expect("power monitor event");
        let HostProtocolEnvelope::Event {
            method,
            payload: Some(payload),
            ..
        } = event
        else {
            panic!("expected power monitor event");
        };
        assert_eq!(method, host_protocol::POWER_MONITOR_SUSPEND_EVENT);
        assert_eq!(payload, json!({ "reason": "sleep" }));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn power_monitor_runtime_sender_installs_initial_power_source_event() {
        let (sender, receiver) = std::sync::mpsc::channel::<HostProtocolEnvelope>();
        install_runtime_event_sender(sender).expect("install power monitor sender");

        let event = receiver.recv().expect("initial power source event");
        clear_runtime_event_sender().expect("clear power monitor sender");

        let HostProtocolEnvelope::Event {
            method, payload, ..
        } = event
        else {
            panic!("expected power monitor event");
        };
        assert_eq!(
            method,
            host_protocol::POWER_MONITOR_POWER_SOURCE_CHANGED_EVENT
        );
        assert!(matches!(
            payload,
            Some(value) if matches!(
                value.get("source").and_then(serde_json::Value::as_str),
                Some("ac" | "battery" | "unknown")
            )
        ));
    }
}

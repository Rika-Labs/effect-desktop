#![allow(clippy::result_large_err)]

use host_protocol::{
    HostProtocolEnvelope, HostProtocolError, ResidentLifecycleDisablePayload,
    ResidentLifecycleEnablePayload, ResidentLifecycleEventPayload, ResidentLifecycleEventPhase,
    ResidentLifecycleProcessPolicy, ResidentLifecycleStatePayload,
    ResidentLifecycleSupportedPayload, ResidentLifecycleWindowPolicy,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::sync::{mpsc::Sender, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

static RESIDENT_STATE: LazyLock<Mutex<ResidentLifecycleStatePayload>> =
    LazyLock::new(|| Mutex::new(ResidentLifecycleStatePayload::disabled()));
#[cfg(test)]
static RESIDENT_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg_attr(test, allow(dead_code))]
pub(crate) enum ResidentWindowCloseAction {
    DestroyAndExit,
    DestroyAndKeepRunning,
    HideAndKeepRunning,
}

pub(crate) fn enable(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ResidentLifecycleEnablePayload>(
        payload,
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
    )?;
    validate_policy(
        input.policy(),
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
    )?;
    validate_optional_printable(
        "ownerScope",
        input.owner_scope(),
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
    )?;
    validate_optional_printable(
        "traceId",
        input.trace_id(),
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
    )?;
    let next = ResidentLifecycleStatePayload::enabled(input.policy().clone());
    replace_state(
        next.clone(),
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
    )?;
    send_event(
        event_sender,
        ResidentLifecycleEventPhase::Enabled,
        next.clone(),
        input
            .trace_id()
            .unwrap_or(host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD),
    );
    encode_payload(next, host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD)
}

pub(crate) fn disable(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ResidentLifecycleDisablePayload>(
        payload,
        host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD,
    )?;
    validate_optional_printable(
        "traceId",
        input.trace_id(),
        host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD,
    )?;
    let next = ResidentLifecycleStatePayload::disabled();
    replace_state(
        next.clone(),
        host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD,
    )?;
    send_event(
        event_sender,
        ResidentLifecycleEventPhase::Disabled,
        next.clone(),
        input
            .trace_id()
            .unwrap_or(host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD),
    );
    encode_payload(next, host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD)
}

pub(crate) fn get_state() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        current_state(host_protocol::RESIDENT_LIFECYCLE_GET_STATE_METHOD)?,
        host_protocol::RESIDENT_LIFECYCLE_GET_STATE_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ResidentLifecycleSupportedPayload::supported(),
        host_protocol::RESIDENT_LIFECYCLE_IS_SUPPORTED_METHOD,
    )
}

#[cfg_attr(test, allow(dead_code))]
pub(crate) fn window_close_action() -> ResidentWindowCloseAction {
    let Ok(state) = RESIDENT_STATE.lock() else {
        return ResidentWindowCloseAction::DestroyAndExit;
    };
    let Some(policy) = state.policy() else {
        return ResidentWindowCloseAction::DestroyAndExit;
    };
    if matches!(
        policy.windows(),
        ResidentLifecycleWindowPolicy::CloseToBackground
    ) {
        return ResidentWindowCloseAction::HideAndKeepRunning;
    }
    if matches!(
        policy.process(),
        ResidentLifecycleProcessPolicy::KeepRunning
    ) {
        return ResidentWindowCloseAction::DestroyAndKeepRunning;
    }
    ResidentWindowCloseAction::DestroyAndExit
}

#[cfg(test)]
pub(crate) fn reset_state_for_test() {
    if let Ok(mut state) = RESIDENT_STATE.lock() {
        *state = ResidentLifecycleStatePayload::disabled();
    }
}

#[cfg(test)]
pub(crate) fn state_test_guard() -> std::sync::MutexGuard<'static, ()> {
    RESIDENT_TEST_LOCK.lock().expect("resident test lock")
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
            format!("failed to encode resident lifecycle payload: {error}"),
            operation,
        )
    })
}

fn validate_policy(
    policy: &host_protocol::ResidentLifecyclePolicyPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if matches!(
        policy.background(),
        host_protocol::ResidentLifecycleBackgroundAvailability::Disabled
    ) && matches!(
        policy.process(),
        host_protocol::ResidentLifecycleProcessPolicy::KeepRunning
    ) {
        return Err(HostProtocolError::invalid_argument(
            "policy.background",
            "keep-running policy requires background availability",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_printable(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(value) = value {
        if value.contains('\0') {
            return Err(HostProtocolError::invalid_argument(
                field,
                "must not contain NUL",
                operation,
            ));
        }
        if value.chars().any(char::is_control) {
            return Err(HostProtocolError::invalid_argument(
                field,
                "must not contain control characters",
                operation,
            ));
        }
        if value.trim().is_empty() {
            return Err(HostProtocolError::invalid_argument(
                field,
                "must be non-empty",
                operation,
            ));
        }
    }
    Ok(())
}

fn current_state(
    operation: &'static str,
) -> Result<ResidentLifecycleStatePayload, HostProtocolError> {
    RESIDENT_STATE
        .lock()
        .map(|state| state.clone())
        .map_err(|_| {
            HostProtocolError::internal("resident lifecycle state lock poisoned", operation)
        })
}

fn replace_state(
    next: ResidentLifecycleStatePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    *RESIDENT_STATE.lock().map_err(|_| {
        HostProtocolError::internal("resident lifecycle state lock poisoned", operation)
    })? = next;
    Ok(())
}

fn send_event(
    sender: Option<Sender<HostProtocolEnvelope>>,
    phase: ResidentLifecycleEventPhase,
    state: ResidentLifecycleStatePayload,
    trace_id: &str,
) {
    let Some(sender) = sender else {
        return;
    };
    let timestamp = now_millis();
    let payload = ResidentLifecycleEventPayload::new(timestamp, phase, state, trace_id);
    let Ok(payload) = to_value(payload) else {
        return;
    };
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::RESIDENT_LIFECYCLE_EVENT.to_string(),
        timestamp,
        trace_id: trace_id.to_string(),
        window_id: None,
        payload: Some(payload),
    });
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{enable, reset_state_for_test, window_close_action, ResidentWindowCloseAction};
    use host_protocol::{HostProtocolEnvelope, HostProtocolError};
    use serde_json::json;
    use std::sync::mpsc;

    #[test]
    fn enable_stores_state_and_emits_event() {
        let _guard = super::state_test_guard();
        reset_state_for_test();
        let (sender, receiver) = mpsc::channel();
        let response = enable(
            Some(json!({
                "policy": {
                    "process": "keep-running",
                    "windows": "close-to-background",
                    "background": "tray",
                    "launchAtLogin": false
                },
                "traceId": "trace-enable"
            })),
            Some(sender),
        )
        .expect("enable should return state");

        assert_eq!(
            response,
            Some(json!({
                "enabled": true,
                "policy": {
                    "process": "keep-running",
                    "windows": "close-to-background",
                    "background": "tray",
                    "launchAtLogin": false
                }
            }))
        );
        assert_eq!(
            window_close_action(),
            ResidentWindowCloseAction::HideAndKeepRunning
        );
        assert!(matches!(
            receiver.try_recv(),
            Ok(HostProtocolEnvelope::Event { method, .. })
                if method == host_protocol::RESIDENT_LIFECYCLE_EVENT
        ));
        reset_state_for_test();
    }

    #[test]
    fn disabled_background_is_rejected_for_keep_running_policy() {
        let _guard = super::state_test_guard();
        reset_state_for_test();
        let error = enable(
            Some(json!({
                "policy": {
                    "process": "keep-running",
                    "windows": "close-to-background",
                    "background": "disabled"
                }
            })),
            None,
        )
        .expect_err("disabled background should be rejected");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
        assert_eq!(
            window_close_action(),
            ResidentWindowCloseAction::DestroyAndExit
        );
    }
}

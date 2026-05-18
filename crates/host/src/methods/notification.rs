#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolEnvelope, HostProtocolError, NotificationClosePayload, NotificationResourcePayload,
    NotificationShowPayload, NotificationSupportedPayload, NOTIFICATION_UNSUPPORTED_REASON,
};
#[cfg(target_os = "linux")]
use host_protocol::{
    NotificationActionEventPayload, NotificationClickEventPayload, NotificationPermissionPayload,
    NotificationPermissionStatePayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::{
    collections::HashMap,
    sync::{mpsc::Sender, LazyLock, Mutex},
};
#[cfg(target_os = "linux")]
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "linux")]
use uuid::Uuid;

static NOTIFICATIONS: LazyLock<Mutex<HashMap<String, StoredNotification>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
#[cfg(target_os = "linux")]
static NOTIFICATION_EVENT_EPOCH: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "linux")]
struct StoredNotification {
    handle: notify_rust::NotificationHandle,
    generation: u64,
    event_epoch: u64,
    owner_scope: String,
}

#[cfg(not(target_os = "linux"))]
struct StoredNotification;

pub(crate) fn show_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<NotificationShowPayload>(
        payload,
        host_protocol::NOTIFICATION_SHOW_METHOD,
    )?;
    validate_text(
        "title",
        input.title(),
        host_protocol::NOTIFICATION_SHOW_METHOD,
    )?;
    validate_text(
        "body",
        input.body(),
        host_protocol::NOTIFICATION_SHOW_METHOD,
    )?;
    validate_actions(input.actions(), host_protocol::NOTIFICATION_SHOW_METHOD)?;
    if let Some(owner_window) = input.owner_window() {
        validate_window_handle(owner_window, host_protocol::NOTIFICATION_SHOW_METHOD)?;
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = event_sender;
        return Err(unsupported(host_protocol::NOTIFICATION_SHOW_METHOD));
    }

    #[cfg(target_os = "linux")]
    {
        ensure_notification_server(host_protocol::NOTIFICATION_SHOW_METHOD)?;
        let notification_id = Uuid::now_v7().to_string();
        let generation = 0;
        let owner_scope = format!("notification:{notification_id}");
        let resource = NotificationResourcePayload::new(
            notification_id.clone(),
            generation,
            owner_scope.clone(),
        );
        let owner_window_id = input.owner_window().map(|window| window.id().to_string());
        let event_epoch = NOTIFICATION_EVENT_EPOCH.load(Ordering::SeqCst);
        let mut notifications = NOTIFICATIONS.lock().map_err(|_| {
            HostProtocolError::internal(
                "notification registry lock poisoned",
                host_protocol::NOTIFICATION_SHOW_METHOD,
            )
        })?;
        let mut notification = notify_rust::Notification::new();
        notification
            .appname("Effect Desktop")
            .summary(input.title())
            .body(input.body());
        for action in input.actions() {
            notification.action(action.id(), action.label());
        }

        let handle = notification.show().map_err(|error| {
            HostProtocolError::internal(
                format!("failed to show notification: {error}"),
                host_protocol::NOTIFICATION_SHOW_METHOD,
            )
        })?;
        let native_id = handle.id();
        notifications.insert(
            notification_id.clone(),
            StoredNotification {
                handle,
                generation,
                event_epoch,
                owner_scope,
            },
        );
        drop(notifications);

        if let Some(sender) = event_sender {
            install_action_observer(
                native_id,
                resource.clone(),
                owner_window_id,
                event_epoch,
                sender,
            );
        }

        encode_payload(resource, host_protocol::NOTIFICATION_SHOW_METHOD)
    }
}

pub(crate) fn close(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<NotificationClosePayload>(
        payload,
        host_protocol::NOTIFICATION_CLOSE_METHOD,
    )?;
    validate_notification_handle(
        input.notification(),
        host_protocol::NOTIFICATION_CLOSE_METHOD,
    )?;

    #[cfg(not(target_os = "linux"))]
    {
        return Err(unsupported(host_protocol::NOTIFICATION_CLOSE_METHOD));
    }

    #[cfg(target_os = "linux")]
    {
        let mut notifications = NOTIFICATIONS.lock().map_err(|_| {
            HostProtocolError::internal(
                "notification registry lock poisoned",
                host_protocol::NOTIFICATION_CLOSE_METHOD,
            )
        })?;
        let Some(stored) = notifications.get(input.notification().id()) else {
            return Err(HostProtocolError::not_found(
                format!("Notification:{}", input.notification().id()),
                host_protocol::NOTIFICATION_CLOSE_METHOD,
            ));
        };
        if stored.generation != input.notification().generation()
            || stored.owner_scope != input.notification().owner_scope()
        {
            return Err(HostProtocolError::invalid_argument(
                "notification",
                "does not match an open notification handle",
                host_protocol::NOTIFICATION_CLOSE_METHOD,
            ));
        }
        let stored = notifications
            .remove(input.notification().id())
            .expect("validated notification exists");
        stored.handle.close();
        Ok(None)
    }
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    #[cfg(target_os = "linux")]
    {
        if ensure_notification_server(host_protocol::NOTIFICATION_IS_SUPPORTED_METHOD).is_err() {
            return encode_payload(
                NotificationSupportedPayload::unsupported(NOTIFICATION_UNSUPPORTED_REASON),
                host_protocol::NOTIFICATION_IS_SUPPORTED_METHOD,
            );
        }
        encode_payload(
            NotificationSupportedPayload::supported(),
            host_protocol::NOTIFICATION_IS_SUPPORTED_METHOD,
        )
    }

    #[cfg(not(target_os = "linux"))]
    {
        encode_payload(
            NotificationSupportedPayload::unsupported(NOTIFICATION_UNSUPPORTED_REASON),
            host_protocol::NOTIFICATION_IS_SUPPORTED_METHOD,
        )
    }
}

pub(crate) fn request_permission() -> Result<Option<Value>, HostProtocolError> {
    permission_payload(host_protocol::NOTIFICATION_REQUEST_PERMISSION_METHOD)
}

pub(crate) fn get_permission_status() -> Result<Option<Value>, HostProtocolError> {
    permission_payload(host_protocol::NOTIFICATION_GET_PERMISSION_STATUS_METHOD)
}

pub(crate) fn clear_runtime_notifications() -> Result<(), HostProtocolError> {
    #[cfg(target_os = "linux")]
    {
        NOTIFICATION_EVENT_EPOCH.fetch_add(1, Ordering::SeqCst);
        let mut notifications = NOTIFICATIONS.lock().map_err(|_| {
            HostProtocolError::internal(
                "notification registry lock poisoned",
                "host.runtime.notification.clear",
            )
        })?;
        for (_, stored) in notifications.drain() {
            stored.handle.close();
        }
        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    {
        let mut notifications = NOTIFICATIONS.lock().map_err(|_| {
            HostProtocolError::internal(
                "notification registry lock poisoned",
                "host.runtime.notification.clear",
            )
        })?;
        notifications.clear();
        Ok(())
    }
}

fn permission_payload(operation: &'static str) -> Result<Option<Value>, HostProtocolError> {
    #[cfg(target_os = "linux")]
    {
        ensure_notification_server(operation)?;
        encode_payload(
            NotificationPermissionPayload::new(NotificationPermissionStatePayload::Granted),
            operation,
        )
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = operation;
        Err(unsupported(operation))
    }
}

#[cfg(target_os = "linux")]
fn install_action_observer(
    native_id: u32,
    notification: NotificationResourcePayload,
    owner_window_id: Option<String>,
    event_epoch: u64,
    sender: Sender<HostProtocolEnvelope>,
) {
    std::thread::spawn(move || {
        let _ = notify_rust::handle_action(native_id, |response| match response {
            notify_rust::ActionResponse::Custom(action) if *action == "default" => {
                if take_active_notification(&notification, event_epoch) {
                    let payload = NotificationClickEventPayload::new(
                        notification.clone(),
                        owner_window_id.clone(),
                    );
                    send_event(
                        &sender,
                        host_protocol::NOTIFICATION_CLICK_EVENT,
                        payload,
                        owner_window_id.clone(),
                    );
                }
            }
            notify_rust::ActionResponse::Custom(action) => {
                if take_active_notification(&notification, event_epoch) {
                    let payload = NotificationActionEventPayload::new(
                        notification.clone(),
                        (*action).to_string(),
                        owner_window_id.clone(),
                    );
                    send_event(
                        &sender,
                        host_protocol::NOTIFICATION_ACTION_EVENT,
                        payload,
                        owner_window_id.clone(),
                    );
                }
            }
            notify_rust::ActionResponse::Closed(_) => {
                let _ = take_active_notification(&notification, event_epoch);
            }
        });
    });
}

#[cfg(target_os = "linux")]
fn take_active_notification(notification: &NotificationResourcePayload, event_epoch: u64) -> bool {
    if NOTIFICATION_EVENT_EPOCH.load(Ordering::SeqCst) != event_epoch {
        return false;
    }

    let Ok(mut notifications) = NOTIFICATIONS.lock() else {
        return false;
    };
    let Some(stored) = notifications.get(notification.id()) else {
        return false;
    };
    if stored.generation != notification.generation()
        || stored.owner_scope != notification.owner_scope()
        || stored.event_epoch != event_epoch
    {
        return false;
    }
    notifications.remove(notification.id());
    true
}

#[cfg(target_os = "linux")]
fn send_event<T: Serialize>(
    sender: &Sender<HostProtocolEnvelope>,
    method: &'static str,
    payload: T,
    window_id: Option<String>,
) {
    let Ok(value) = to_value(payload) else {
        return;
    };
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: method.to_string(),
        timestamp: timestamp_millis(),
        trace_id: format!("notification-event-{}", Uuid::now_v7()),
        window_id,
        payload: Some(value),
    });
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
    to_value(payload)
        .map(Some)
        .map_err(|error| HostProtocolError::invalid_output(operation, error.to_string()))
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(NOTIFICATION_UNSUPPORTED_REASON, operation)
}

#[cfg(target_os = "linux")]
fn ensure_notification_server(operation: &'static str) -> Result<(), HostProtocolError> {
    notify_rust::get_server_information()
        .map(|_| ())
        .map_err(|_| unsupported(operation))
}

fn validate_notification_handle(
    notification: &NotificationResourcePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("notification.id", notification.id(), operation)?;
    validate_non_empty(
        "notification.ownerScope",
        notification.owner_scope(),
        operation,
    )?;
    if notification.kind() != "notification" {
        return Err(HostProtocolError::invalid_argument(
            "notification.kind",
            "must be notification",
            operation,
        ));
    }
    if notification.state() != "open" {
        return Err(HostProtocolError::invalid_argument(
            "notification.state",
            "must be open",
            operation,
        ));
    }
    Ok(())
}

fn validate_window_handle(
    window: &host_protocol::NotificationWindowResourcePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("ownerWindow.id", window.id(), operation)?;
    validate_non_empty("ownerWindow.ownerScope", window.owner_scope(), operation)?;
    if window.kind() != "window" {
        return Err(HostProtocolError::invalid_argument(
            "ownerWindow.kind",
            "must be window",
            operation,
        ));
    }
    if window.state() != "open" {
        return Err(HostProtocolError::invalid_argument(
            "ownerWindow.state",
            "must be open",
            operation,
        ));
    }
    Ok(())
}

fn validate_actions(
    actions: &[host_protocol::NotificationActionPayload],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for action in actions {
        validate_text("actions.id", action.id(), operation)?;
        validate_text("actions.label", action.label(), operation)?;
    }
    Ok(())
}

fn validate_text(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f)) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_non_empty(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn notification_show_rejects_malformed_text() {
        let error = show_with_event_sender(
            Some(json!({
                "title": "Build\nfinished",
                "body": "Open results"
            })),
            None,
        )
        .expect_err("control characters must be rejected before host work starts");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn notification_close_rejects_malformed_handle() {
        let error = close(Some(json!({
            "notification": {
                "kind": "notification",
                "id": "",
                "generation": 0,
                "ownerScope": "notification:notification-1",
                "state": "open"
            }
        })))
        .expect_err("empty handle ids must be rejected before registry lookup");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }
}

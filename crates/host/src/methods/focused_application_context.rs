#![allow(clippy::result_large_err)]

use host_protocol::{
    FocusedApplicationContextActorPayload, FocusedApplicationContextSnapshotPayload,
    FocusedApplicationContextSnapshotResultPayload, FocusedApplicationContextSupportedPayload,
    FocusedApplicationMetadataPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn snapshot(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<FocusedApplicationContextSnapshotPayload>(
        payload,
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
    )?;
    validate_trace_id(
        input.trace_id(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
    )?;
    encode_payload(
        focused_application_snapshot(host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD)?,
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        FocusedApplicationContextSupportedPayload::unsupported(
            host_protocol::FOCUSED_APPLICATION_CONTEXT_UNSUPPORTED_REASON,
        ),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_IS_SUPPORTED_METHOD,
    )
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
            format!("failed to encode focused application context payload: {error}"),
            operation,
        )
    })
}

fn validate_actor(
    actor: &FocusedApplicationContextActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_trace_id(
    trace_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(trace_id) = trace_id {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_no_nul(field, value, operation)?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_printable_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_no_nul(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL",
            operation,
        ));
    }
    Ok(())
}

#[cfg(not(all(target_os = "macos", not(test))))]
fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_UNSUPPORTED_REASON,
        operation,
    )
}

fn focused_application_snapshot(
    operation: &'static str,
) -> Result<FocusedApplicationContextSnapshotResultPayload, HostProtocolError> {
    if let Some(application) = test_focused_application() {
        return Ok(snapshot_payload(application, observed_at_ms(operation)?));
    }

    #[cfg(all(target_os = "macos", not(test)))]
    {
        macos_focused_application::snapshot(operation)
    }

    #[cfg(not(all(target_os = "macos", not(test))))]
    {
        Err(unsupported(operation))
    }
}

fn snapshot_payload(
    application: HostFocusedApplication,
    observed_at: u64,
) -> FocusedApplicationContextSnapshotResultPayload {
    FocusedApplicationContextSnapshotResultPayload::new(application.into_payload(), observed_at)
}

fn observed_at_ms(operation: &'static str) -> Result<u64, HostProtocolError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| HostProtocolError::internal(error.to_string(), operation))?;
    u64::try_from(duration.as_millis()).map_err(|_| {
        HostProtocolError::internal(
            "focused application observation timestamp overflowed u64",
            operation,
        )
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct HostFocusedApplication {
    application_id: String,
    name: Option<String>,
    bundle_id: Option<String>,
    executable_path: Option<String>,
    process_id: Option<u64>,
}

impl HostFocusedApplication {
    #[cfg(any(test, target_os = "macos"))]
    fn new(application_id: impl Into<String>) -> Self {
        Self {
            application_id: application_id.into(),
            name: None,
            bundle_id: None,
            executable_path: None,
            process_id: None,
        }
    }

    fn into_payload(self) -> FocusedApplicationMetadataPayload {
        let mut payload = FocusedApplicationMetadataPayload::new(self.application_id);
        if let Some(name) = self.name {
            payload = payload.with_name(name);
        }
        if let Some(bundle_id) = self.bundle_id {
            payload = payload.with_bundle_id(bundle_id);
        }
        if let Some(executable_path) = self.executable_path {
            payload = payload.with_executable_path(executable_path);
        }
        if let Some(process_id) = self.process_id {
            payload = payload.with_process_id(process_id);
        }
        payload
    }
}

#[cfg(not(test))]
fn test_focused_application() -> Option<HostFocusedApplication> {
    None
}

#[cfg(test)]
thread_local! {
    static TEST_FOCUSED_APPLICATION: std::cell::RefCell<Option<HostFocusedApplication>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn test_focused_application() -> Option<HostFocusedApplication> {
    TEST_FOCUSED_APPLICATION.with(|state| state.borrow().clone())
}

#[cfg(all(target_os = "macos", not(test)))]
fn bridge_safe_non_empty(value: String) -> Option<String> {
    if value.is_empty() || value.contains('\0') {
        return None;
    }
    Some(value)
}

#[cfg(all(target_os = "macos", not(test)))]
fn printable_non_empty(value: String) -> Option<String> {
    if value.is_empty() || value.contains(char::is_control) {
        return None;
    }
    Some(value)
}

#[cfg(all(target_os = "macos", not(test)))]
mod macos_focused_application {
    use super::{
        bridge_safe_non_empty, observed_at_ms, printable_non_empty, snapshot_payload,
        HostFocusedApplication, HostProtocolError,
    };
    use objc2_app_kit::NSWorkspace;

    pub(super) fn snapshot(
        operation: &'static str,
    ) -> Result<host_protocol::FocusedApplicationContextSnapshotResultPayload, HostProtocolError>
    {
        let Some(application) = NSWorkspace::sharedWorkspace().frontmostApplication() else {
            return Err(HostProtocolError::internal(
                "macOS did not report a frontmost application",
                operation,
            ));
        };

        let name = application
            .localizedName()
            .map(|name| name.to_string())
            .and_then(printable_non_empty);
        let bundle_id = application
            .bundleIdentifier()
            .map(|bundle_id| bundle_id.to_string())
            .and_then(bridge_safe_non_empty);
        let executable_path = application
            .executableURL()
            .and_then(|url| url.path())
            .map(|path| path.to_string())
            .and_then(printable_non_empty);
        let process_id = u64::try_from(application.processIdentifier()).ok();

        let application_id = bundle_id
            .clone()
            .or_else(|| process_id.map(|pid| format!("pid:{pid}")))
            .or_else(|| name.clone())
            .unwrap_or_else(|| "frontmost-application".to_string());

        let mut host_application = HostFocusedApplication::new(application_id);
        host_application.name = name;
        host_application.bundle_id = bundle_id;
        host_application.executable_path = executable_path;
        host_application.process_id = process_id;

        Ok(snapshot_payload(
            host_application,
            observed_at_ms(operation)?,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::{
        FocusedApplicationContextEventPayload, FocusedApplicationContextSnapshotResultPayload,
        FocusedApplicationContextStopWatchingResultPayload,
        FocusedApplicationContextWatchResultPayload, FocusedApplicationMetadataPayload,
        HostProtocolError,
    };
    use serde_json::json;

    #[test]
    fn snapshot_validates_before_returning_unsupported() {
        let error = snapshot(Some(valid_snapshot())).expect_err("host adapter is not implemented");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn snapshot_encodes_focused_application_metadata() {
        TEST_FOCUSED_APPLICATION.with(|state| {
            let mut application = HostFocusedApplication::new("com.example.App");
            application.name = Some("Example App".to_string());
            application.bundle_id = Some("com.example.App".to_string());
            application.executable_path =
                Some("/Applications/Example.app/Contents/MacOS/App".to_string());
            application.process_id = Some(42);
            *state.borrow_mut() = Some(application);
        });

        let payload = snapshot(Some(valid_snapshot()))
            .expect("focused application snapshot should encode")
            .expect("snapshot returns payload");

        TEST_FOCUSED_APPLICATION.with(|state| {
            *state.borrow_mut() = None;
        });

        assert_eq!(
            payload["application"],
            json!({
                "applicationId": "com.example.App",
                "name": "Example App",
                "bundleId": "com.example.App",
                "executablePath": "/Applications/Example.app/Contents/MacOS/App",
                "processId": 42
            })
        );
        assert!(payload["observedAt"].as_u64().is_some());
    }

    #[test]
    fn snapshot_rejects_control_byte_actor_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace\n1" }
        });

        let error = snapshot(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn is_supported_reports_unimplemented_adapter() {
        let payload = is_supported()
            .expect("support query should encode")
            .expect("support query returns payload");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::FOCUSED_APPLICATION_CONTEXT_UNSUPPORTED_REASON
            })
        );
    }

    #[test]
    fn protocol_result_and_event_payloads_encode_camel_case_contracts() {
        let snapshot = serde_json::to_value(FocusedApplicationContextSnapshotResultPayload::new(
            FocusedApplicationMetadataPayload::new("app-1"),
            100,
        ))
        .expect("snapshot should encode");
        let watch = serde_json::to_value(FocusedApplicationContextWatchResultPayload::new(
            "watch-1", true,
        ))
        .expect("watch should encode");
        let stopped = serde_json::to_value(
            FocusedApplicationContextStopWatchingResultPayload::new("watch-1", true),
        )
        .expect("stop result should encode");
        let event = serde_json::to_value(FocusedApplicationContextEventPayload::watch_started(
            100, "watch-1",
        ))
        .expect("event should encode");

        assert_eq!(snapshot["application"]["applicationId"], json!("app-1"));
        assert_eq!(snapshot["observedAt"], json!(100));
        assert_eq!(watch["watchId"], json!("watch-1"));
        assert_eq!(stopped["stopped"], json!(true));
        assert_eq!(event["type"], json!("focused-application-context-event"));
        assert_eq!(event["phase"], json!("watch-started"));
        assert_eq!(event["watchId"], json!("watch-1"));
    }

    fn valid_snapshot() -> Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "traceId": "trace-1"
        })
    }
}

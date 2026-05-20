#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    AssociationEventPayload, AssociationEventPhasePayload, AssociationFileAssociationPayload,
    AssociationFileAssociationsPayload, AssociationFileAssociationsResultPayload,
    AssociationProtocolPayload, AssociationProtocolStatusPayload, HostProtocolEnvelope,
    HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::sync::mpsc::Sender;
use uuid::Uuid;

#[cfg(any(test, target_os = "macos"))]
const APP_ID_ENV: &str = "EFFECT_DESKTOP_APP_ID";
#[cfg(any(test, target_os = "macos"))]
const DEFAULT_APP_ID: &str = "dev.effect-desktop.host";
const RESERVED_SCHEMES: &[&str] = &[
    "about",
    "app",
    "blob",
    "data",
    "file",
    "http",
    "https",
    "javascript",
    "vbscript",
    "chrome",
    "view-source",
];

#[cfg(test)]
thread_local! {
    static TEST_ASSOCIATIONS: std::cell::RefCell<Option<TestAssociationState>> =
        const { std::cell::RefCell::new(None) };
}

#[derive(Clone, Debug, Default)]
#[cfg(test)]
struct TestAssociationState {
    protocol_handlers: std::collections::BTreeMap<String, String>,
    extension_handlers: std::collections::BTreeMap<String, String>,
}

#[cfg(test)]
pub(crate) fn is_default_protocol_client(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    is_default_protocol_client_with_event_sender(payload, None)
}

pub(crate) fn is_default_protocol_client_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AssociationProtocolPayload>(
        payload,
        host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
    )?;
    validate_scheme(
        input.scheme(),
        host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
    )?;
    with_event(
        event_sender,
        AssociationEventPhasePayload::ProtocolChecked,
        || {
            encode_payload(
                AssociationProtocolStatusPayload::new(
                    input.scheme(),
                    platform_is_default_protocol_client(
                        input.scheme(),
                        host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
                    )?,
                ),
                host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
            )
        },
    )
}

#[cfg(test)]
pub(crate) fn set_default_protocol_client(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    set_default_protocol_client_with_event_sender(payload, None)
}

pub(crate) fn set_default_protocol_client_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AssociationProtocolPayload>(
        payload,
        host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
    )?;
    validate_scheme(
        input.scheme(),
        host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
    )?;
    with_event(
        event_sender,
        AssociationEventPhasePayload::ProtocolUpdated,
        || {
            platform_set_default_protocol_client(
                input.scheme(),
                host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
            )?;
            Ok(None)
        },
    )
}

#[cfg(test)]
pub(crate) fn get_file_associations(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    get_file_associations_with_event_sender(payload, None)
}

pub(crate) fn get_file_associations_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(
        payload.as_ref(),
        "extensions",
        host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
    )?;
    let input = decode_payload::<AssociationFileAssociationsPayload>(
        payload,
        host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
    )?;
    if let Some(extensions) = input.extensions() {
        for extension in extensions {
            validate_extension(
                extension,
                host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
            )?;
        }
    }
    with_event(
        event_sender,
        AssociationEventPhasePayload::FileAssociationsChecked,
        || {
            let associations = input
                .extensions()
                .unwrap_or(&[])
                .iter()
                .map(|extension| {
                    platform_is_default_file_association(
                        extension,
                        host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
                    )
                    .map(|is_default| AssociationFileAssociationPayload::new(extension, is_default))
                })
                .collect::<Result<Vec<_>, HostProtocolError>>()?;
            encode_payload(
                AssociationFileAssociationsResultPayload::new(associations),
                host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
            )
        },
    )
}

fn with_event(
    event_sender: Option<Sender<HostProtocolEnvelope>>,
    success_phase: AssociationEventPhasePayload,
    action: impl FnOnce() -> Result<Option<Value>, HostProtocolError>,
) -> Result<Option<Value>, HostProtocolError> {
    match action() {
        Ok(payload) => {
            send_event(
                event_sender,
                AssociationEventPayload::new(success_phase, None),
            );
            Ok(payload)
        }
        Err(error) => {
            send_event(
                event_sender,
                AssociationEventPayload::new(
                    AssociationEventPhasePayload::Failed,
                    Some(error.tag().to_string()),
                ),
            );
            Err(error)
        }
    }
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

fn reject_null_field(
    payload: Option<&Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if matches!(
        payload
            .and_then(Value::as_object)
            .and_then(|object| object.get(field)),
        Some(Value::Null)
    ) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be omitted instead of null",
            operation,
        ));
    }
    Ok(())
}

fn validate_scheme(scheme: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if scheme.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must be non-empty",
            operation,
        ));
    }
    let mut chars = scheme.chars();
    let Some(first) = chars.next() else {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must be non-empty",
            operation,
        ));
    };
    if !first.is_ascii_lowercase()
        || !chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || "+.-".contains(ch))
    {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must match ^[a-z][a-z0-9+.-]*$",
            operation,
        ));
    }
    if RESERVED_SCHEMES.contains(&scheme) {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "is reserved",
            operation,
        ));
    }
    Ok(())
}

fn validate_extension(extension: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if !extension.starts_with('.') || extension.len() < 2 {
        return Err(HostProtocolError::invalid_argument(
            "extensions",
            "entries must start with a dot and include a name",
            operation,
        ));
    }
    if !extension
        .chars()
        .nth(1)
        .is_some_and(|ch| ch.is_ascii_alphanumeric())
    {
        return Err(HostProtocolError::invalid_argument(
            "extensions",
            "entries must start with a dot followed by an ASCII letter or digit",
            operation,
        ));
    }
    if extension.contains("..") {
        return Err(HostProtocolError::invalid_argument(
            "extensions",
            "entries must not contain traversal segments",
            operation,
        ));
    }
    if extension
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')))
    {
        return Err(HostProtocolError::invalid_argument(
            "extensions",
            "entries must contain only ASCII letters, digits, dot, underscore, or hyphen",
            operation,
        ));
    }
    Ok(())
}

fn send_event(sender: Option<Sender<HostProtocolEnvelope>>, payload: AssociationEventPayload) {
    let Some(sender) = sender else {
        return;
    };
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::ASSOCIATION_EVENT.to_string(),
        timestamp: 0,
        trace_id: format!("association-event-{}", Uuid::now_v7()),
        window_id: None,
        payload: to_value(payload).ok(),
    });
}

#[cfg(any(test, target_os = "macos"))]
fn app_id(operation: &'static str) -> Result<String, HostProtocolError> {
    let id = std::env::var(APP_ID_ENV).unwrap_or_else(|_| DEFAULT_APP_ID.to_string());
    if id.is_empty()
        || id.chars().any(char::is_control)
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(HostProtocolError::invalid_argument(
            "appId",
            "must contain only ASCII letters, digits, '.', '-', or '_'",
            operation,
        ));
    }
    Ok(id)
}

#[cfg(all(target_os = "macos", not(test)))]
fn platform_is_default_protocol_client(
    scheme: &str,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    macos_association::is_default_protocol_client(scheme, &app_id(operation)?, operation)
}

#[cfg(any(not(target_os = "macos"), test))]
fn platform_is_default_protocol_client(
    scheme: &str,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    test_is_default_protocol_client(scheme, operation)
        .unwrap_or_else(|| Err(unsupported(operation)))
}

#[cfg(all(target_os = "macos", not(test)))]
fn platform_set_default_protocol_client(
    scheme: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    macos_association::set_default_protocol_client(scheme, &app_id(operation)?, operation)
}

#[cfg(any(not(target_os = "macos"), test))]
fn platform_set_default_protocol_client(
    scheme: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    test_set_default_protocol_client(scheme, operation)
        .unwrap_or_else(|| Err(unsupported(operation)))
}

#[cfg(all(target_os = "macos", not(test)))]
fn platform_is_default_file_association(
    extension: &str,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    macos_association::is_default_file_association(extension, &app_id(operation)?, operation)
}

#[cfg(any(not(target_os = "macos"), test))]
fn platform_is_default_file_association(
    extension: &str,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    test_is_default_file_association(extension, operation)
        .unwrap_or_else(|| Err(unsupported(operation)))
}

#[cfg(any(not(target_os = "macos"), test))]
fn test_is_default_protocol_client(
    scheme: &str,
    operation: &'static str,
) -> Option<Result<bool, HostProtocolError>> {
    #[cfg(test)]
    {
        TEST_ASSOCIATIONS.with(|state| {
            let state = state.borrow();
            let state = state.as_ref()?;
            let id = app_id(operation);
            Some(id.map(|id| state.protocol_handlers.get(scheme) == Some(&id)))
        })
    }
    #[cfg(not(test))]
    {
        let _ = (scheme, operation);
        None
    }
}

#[cfg(any(not(target_os = "macos"), test))]
fn test_set_default_protocol_client(
    scheme: &str,
    operation: &'static str,
) -> Option<Result<(), HostProtocolError>> {
    #[cfg(test)]
    {
        TEST_ASSOCIATIONS.with(|state| {
            let mut state = state.borrow_mut();
            let state = state.as_mut()?;
            Some(app_id(operation).map(|id| {
                state.protocol_handlers.insert(scheme.to_string(), id);
            }))
        })
    }
    #[cfg(not(test))]
    {
        let _ = (scheme, operation);
        None
    }
}

#[cfg(any(not(target_os = "macos"), test))]
fn test_is_default_file_association(
    extension: &str,
    operation: &'static str,
) -> Option<Result<bool, HostProtocolError>> {
    #[cfg(test)]
    {
        TEST_ASSOCIATIONS.with(|state| {
            let state = state.borrow();
            let state = state.as_ref()?;
            let id = app_id(operation);
            Some(id.map(|id| state.extension_handlers.get(extension) == Some(&id)))
        })
    }
    #[cfg(not(test))]
    {
        let _ = (extension, operation);
        None
    }
}

#[cfg(all(target_os = "macos", not(test)))]
mod macos_association {
    use super::HostProtocolError;
    use core_foundation::{
        base::{OSStatus, TCFType},
        string::{CFString, CFStringRef},
    };

    const K_LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        static kUTTagClassFilenameExtension: CFStringRef;

        fn LSCopyDefaultHandlerForURLScheme(scheme: CFStringRef) -> CFStringRef;
        fn LSSetDefaultHandlerForURLScheme(scheme: CFStringRef, handler: CFStringRef) -> OSStatus;
        fn UTTypeCreatePreferredIdentifierForTag(
            tag_class: CFStringRef,
            tag: CFStringRef,
            conforming_to_uti: CFStringRef,
        ) -> CFStringRef;
        fn LSCopyDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            roles: u32,
        ) -> CFStringRef;
    }

    pub(super) fn is_default_protocol_client(
        scheme: &str,
        app_id: &str,
        _operation: &'static str,
    ) -> Result<bool, HostProtocolError> {
        Ok(default_protocol_handler(scheme).is_some_and(|handler| handler == app_id))
    }

    pub(super) fn set_default_protocol_client(
        scheme: &str,
        app_id: &str,
        operation: &'static str,
    ) -> Result<(), HostProtocolError> {
        let scheme = CFString::new(scheme);
        let handler = CFString::new(app_id);
        let status = unsafe {
            LSSetDefaultHandlerForURLScheme(
                scheme.as_concrete_TypeRef(),
                handler.as_concrete_TypeRef(),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(launch_services_unavailable(
                format!(
                    "LaunchServices failed to set default protocol handler for {operation}: OSStatus {status}"
                ),
                operation,
            ))
        }
    }

    pub(super) fn is_default_file_association(
        extension: &str,
        app_id: &str,
        _operation: &'static str,
    ) -> Result<bool, HostProtocolError> {
        Ok(default_file_handler(extension).is_some_and(|handler| handler == app_id))
    }

    fn default_protocol_handler(scheme: &str) -> Option<String> {
        let scheme = CFString::new(scheme);
        let handler = unsafe { LSCopyDefaultHandlerForURLScheme(scheme.as_concrete_TypeRef()) };
        unsafe_cf_string(handler)
    }

    fn default_file_handler(extension: &str) -> Option<String> {
        let extension = CFString::new(extension.trim_start_matches('.'));
        let uti = unsafe {
            UTTypeCreatePreferredIdentifierForTag(
                kUTTagClassFilenameExtension,
                extension.as_concrete_TypeRef(),
                std::ptr::null(),
            )
        };
        if uti.is_null() {
            return None;
        }
        let handler = unsafe { LSCopyDefaultRoleHandlerForContentType(uti, K_LS_ROLES_ALL) };
        let _uti = unsafe { CFString::wrap_under_create_rule(uti) };
        unsafe_cf_string(handler)
    }

    fn unsafe_cf_string(value: CFStringRef) -> Option<String> {
        if value.is_null() {
            return None;
        }
        Some(unsafe { CFString::wrap_under_create_rule(value) }.to_string())
    }

    fn launch_services_unavailable(message: String, operation: &'static str) -> HostProtocolError {
        HostProtocolError::HostUnavailable {
            message,
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("HostUnavailable")
                .expect("known tag"),
            remediation: None,
            docs_url: None,
        }
    }
}

#[cfg(any(not(target_os = "macos"), test))]
fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::ASSOCIATION_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{
        get_file_associations, get_file_associations_with_event_sender, is_default_protocol_client,
        set_default_protocol_client, set_default_protocol_client_with_event_sender,
        TestAssociationState, TEST_ASSOCIATIONS,
    };
    use host_protocol::{HostProtocolEnvelope, HostProtocolError};
    use serde_json::json;
    use std::sync::mpsc::channel;

    #[test]
    fn association_requests_decode_before_unsupported() {
        assert_eq!(
            is_default_protocol_client(Some(json!({ "scheme": "example" }))).expect_err("status"),
            HostProtocolError::unsupported(
                host_protocol::ASSOCIATION_UNSUPPORTED_REASON,
                host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
            )
        );
        assert_eq!(
            set_default_protocol_client(Some(json!({ "scheme": "example" })))
                .expect_err("set default"),
            HostProtocolError::unsupported(
                host_protocol::ASSOCIATION_UNSUPPORTED_REASON,
                host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
            )
        );
        assert_eq!(
            get_file_associations(Some(json!({ "extensions": [".txt"] })))
                .expect_err("file associations"),
            HostProtocolError::unsupported(
                host_protocol::ASSOCIATION_UNSUPPORTED_REASON,
                host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
            )
        );
    }

    #[test]
    fn association_adapter_updates_protocol_and_reports_file_associations() {
        with_associations(
            TestAssociationState {
                extension_handlers: [(".txt".to_string(), "dev.effect-desktop.host".to_string())]
                    .into_iter()
                    .collect(),
                ..TestAssociationState::default()
            },
            || {
                let status = is_default_protocol_client(Some(json!({ "scheme": "example" })))
                    .expect("status")
                    .expect("payload");
                assert_eq!(status["isDefault"], false);

                set_default_protocol_client(Some(json!({ "scheme": "example" })))
                    .expect("set default");

                let status = is_default_protocol_client(Some(json!({ "scheme": "example" })))
                    .expect("status")
                    .expect("payload");
                assert_eq!(status["isDefault"], true);

                let associations =
                    get_file_associations(Some(json!({ "extensions": [".txt", ".md"] })))
                        .expect("associations")
                        .expect("payload");
                assert_eq!(
                    associations,
                    json!({
                        "associations": [
                            { "extension": ".txt", "isDefault": true },
                            { "extension": ".md", "isDefault": false }
                        ]
                    })
                );
            },
        );
    }

    #[test]
    fn association_requests_emit_lifecycle_events() {
        with_associations(TestAssociationState::default(), || {
            let (sender, receiver) = channel();
            set_default_protocol_client_with_event_sender(
                Some(json!({ "scheme": "example" })),
                Some(sender.clone()),
            )
            .expect("set default");
            get_file_associations_with_event_sender(
                Some(json!({ "extensions": [".txt"] })),
                Some(sender),
            )
            .expect("file associations");

            let first = receiver.recv().expect("protocol event");
            let second = receiver.recv().expect("file association event");
            assert_event(first, "protocol-updated");
            assert_event(second, "file-associations-checked");
        });
    }

    #[test]
    fn association_requests_reject_invalid_inputs_before_unsupported() {
        assert_eq!(
            is_default_protocol_client(Some(json!({ "scheme": "https" })))
                .expect_err("reserved scheme")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            is_default_protocol_client(Some(json!({ "scheme": "vbscript" })))
                .expect_err("dangerous scheme")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            get_file_associations(Some(json!({ "extensions": null }))).expect_err("null"),
            HostProtocolError::invalid_argument(
                "extensions",
                "must be omitted instead of null",
                host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
            )
        );
        assert_eq!(
            get_file_associations(Some(json!({ "extensions": ["../txt"] })))
                .expect_err("bad extension")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            get_file_associations(Some(json!({ "extensions": [".-"] })))
                .expect_err("bad extension start")
                .tag(),
            "InvalidArgument"
        );
    }

    fn with_associations(state: TestAssociationState, run: impl FnOnce()) {
        TEST_ASSOCIATIONS.with(|cell| {
            *cell.borrow_mut() = Some(state);
            run();
            *cell.borrow_mut() = None;
        });
    }

    fn assert_event(event: HostProtocolEnvelope, phase: &str) {
        let HostProtocolEnvelope::Event {
            method, payload, ..
        } = event
        else {
            panic!("expected association event");
        };
        assert_eq!(method, host_protocol::ASSOCIATION_EVENT);
        assert_eq!(payload.expect("payload")["phase"], phase);
    }
}

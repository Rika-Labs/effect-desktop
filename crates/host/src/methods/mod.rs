mod diagnostics_bundle;
mod dock;
mod egress_policy;
mod execution_sandbox;
mod extension_config;
mod extension_package;
pub(crate) mod handshake;
mod local_tool_runtime;
mod menu;
mod realtime_media_session;
mod transactional_file_mutation;
mod window;
mod workspace_index;

use crate::{linux, window::WindowMethodHandler};
use host_protocol::{HostProtocolEnvelope, HostProtocolError};
use std::sync::{mpsc::Sender, Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

type RealtimeMediaHandler = fn(
    &str,
    Option<serde_json::Value>,
    u64,
    Option<&str>,
    Option<Sender<HostProtocolEnvelope>>,
    Option<Sender<realtime_media_session::SessionKey>>,
) -> realtime_media_session::EventfulResponse;

type ExtensionConfigHandler =
    fn(Option<serde_json::Value>, u64) -> extension_config::EventfulResponse;

struct RealtimeMediaDispatch {
    id: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct ExtensionConfigDispatch {
    id: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

#[derive(Clone)]
pub(crate) struct HostMethodRouter {
    window: Arc<dyn WindowMethodHandler>,
    runtime_event_sender: Arc<Mutex<Option<Sender<HostProtocolEnvelope>>>>,
    runtime_session_failure_sender: Arc<Mutex<Option<Sender<realtime_media_session::SessionKey>>>>,
}

impl HostMethodRouter {
    pub(crate) fn new(window: Arc<dyn WindowMethodHandler>) -> Self {
        Self {
            window,
            runtime_event_sender: Arc::new(Mutex::new(None)),
            runtime_session_failure_sender: Arc::new(Mutex::new(None)),
        }
    }

    pub(crate) fn dispatch_frames(
        &self,
        envelope: HostProtocolEnvelope,
    ) -> Vec<HostProtocolEnvelope> {
        self.dispatch_frames_at(envelope, timestamp_millis())
    }

    fn dispatch_cancel(&self, envelope: &HostProtocolEnvelope) -> Result<(), String> {
        let HostProtocolEnvelope::Cancel {
            id, resource_id, ..
        } = envelope
        else {
            return Ok(());
        };
        realtime_media_session::close_session_for_cancel(
            id.as_deref(),
            resource_id.as_deref(),
            "host.runtime.cancel",
        )
        .map_err(|error| format!("{error:?}"))
    }

    pub(crate) fn clear_runtime_resources(&self) -> Result<(), String> {
        realtime_media_session::close_all_sessions("host.runtime.disconnect")
            .map_err(|error| format!("{error:?}"))
    }

    pub(crate) fn install_runtime_event_sender(
        &self,
        sender: Sender<HostProtocolEnvelope>,
    ) -> Result<(), String> {
        *self
            .runtime_event_sender
            .lock()
            .map_err(|_| "runtime event sender lock poisoned".to_string())? = Some(sender);
        Ok(())
    }

    pub(crate) fn clear_runtime_event_sender(&self) -> Result<(), String> {
        *self
            .runtime_event_sender
            .lock()
            .map_err(|_| "runtime event sender lock poisoned".to_string())? = None;
        Ok(())
    }

    pub(crate) fn install_runtime_session_failure_sender(
        &self,
        sender: Sender<realtime_media_session::SessionKey>,
    ) -> Result<(), String> {
        *self
            .runtime_session_failure_sender
            .lock()
            .map_err(|_| "runtime session failure sender lock poisoned".to_string())? =
            Some(sender);
        Ok(())
    }

    pub(crate) fn clear_runtime_session_failure_sender(&self) -> Result<(), String> {
        *self
            .runtime_session_failure_sender
            .lock()
            .map_err(|_| "runtime session failure sender lock poisoned".to_string())? = None;
        Ok(())
    }

    pub(crate) fn handle_realtime_media_session_failure(
        &self,
        key: realtime_media_session::SessionKey,
    ) {
        realtime_media_session::handle_session_failure(key);
    }

    #[cfg(test)]
    fn dispatch_at(
        &self,
        envelope: HostProtocolEnvelope,
        timestamp: u64,
    ) -> Option<HostProtocolEnvelope> {
        self.dispatch_frames_at(envelope, timestamp)
            .into_iter()
            .next()
    }

    fn dispatch_frames_at(
        &self,
        envelope: HostProtocolEnvelope,
        timestamp: u64,
    ) -> Vec<HostProtocolEnvelope> {
        if matches!(envelope, HostProtocolEnvelope::Cancel { .. }) {
            let _ = self.dispatch_cancel(&envelope);
            return Vec::new();
        }

        let HostProtocolEnvelope::Request {
            id,
            method,
            trace_id,
            window_id,
            payload,
            ..
        } = envelope
        else {
            return Vec::new();
        };

        if method == host_protocol::EGRESS_POLICY_RECORD_METHOD {
            let (payload, event_payload, error) =
                match egress_policy::record_with_event(payload, timestamp) {
                    Ok((payload, event_payload)) => (payload, event_payload, None),
                    Err(error) => (None, None, Some(error)),
                };

            let response = HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id: trace_id.clone(),
                payload,
                error,
            };

            return match event_payload {
                Some(payload) => vec![
                    HostProtocolEnvelope::Event {
                        method: host_protocol::EGRESS_POLICY_DECISION_RECORDED_EVENT.to_string(),
                        timestamp,
                        trace_id,
                        window_id,
                        payload: Some(payload),
                    },
                    response,
                ],
                None => vec![response],
            };
        }

        let result = match method.as_str() {
            host_protocol::HOST_PING_METHOD => Ok(None),
            host_protocol::HOST_VERSION_METHOD => Ok(Some(handshake::version_payload())),
            host_protocol::WINDOW_CREATE_METHOD => window::create(&*self.window, payload),
            host_protocol::WINDOW_DESTROY_METHOD => {
                let destroy_payload = payload.clone();
                let result = window::destroy(&*self.window, payload);
                if result.is_ok() {
                    if let Some(window_id) = decode_window_destroy_id(destroy_payload) {
                        if let Err(error) = realtime_media_session::close_sessions_for_window(
                            &window_id,
                            host_protocol::WINDOW_DESTROY_METHOD,
                        ) {
                            return vec![HostProtocolEnvelope::Response {
                                id,
                                timestamp,
                                trace_id,
                                payload: None,
                                error: Some(error),
                            }];
                        }
                    }
                }
                result
            }
            host_protocol::DOCK_SET_BADGE_COUNT_METHOD => {
                dock::set_badge_count(&*self.window, payload)
            }
            host_protocol::DOCK_SET_BADGE_TEXT_METHOD => {
                dock::set_badge_text(&*self.window, payload)
            }
            host_protocol::DOCK_SET_MENU_METHOD => dock::set_menu(&*self.window, payload),
            host_protocol::DOCK_REQUEST_ATTENTION_METHOD => {
                dock::request_attention(&*self.window, payload)
            }
            host_protocol::DOCK_IS_SUPPORTED_METHOD => linux::dock_is_supported(payload),
            host_protocol::GLOBAL_SHORTCUT_REGISTER_METHOD => Err(
                linux::unsupported_global_shortcut(host_protocol::GLOBAL_SHORTCUT_REGISTER_METHOD),
            ),
            host_protocol::GLOBAL_SHORTCUT_UNREGISTER_METHOD => {
                Err(linux::unsupported_global_shortcut(
                    host_protocol::GLOBAL_SHORTCUT_UNREGISTER_METHOD,
                ))
            }
            host_protocol::GLOBAL_SHORTCUT_UNREGISTER_ALL_METHOD => {
                Err(linux::unsupported_global_shortcut(
                    host_protocol::GLOBAL_SHORTCUT_UNREGISTER_ALL_METHOD,
                ))
            }
            host_protocol::GLOBAL_SHORTCUT_IS_REGISTERED_METHOD => {
                linux::global_shortcut_is_registered()
            }
            host_protocol::GLOBAL_SHORTCUT_IS_SUPPORTED_METHOD => {
                linux::global_shortcut_is_supported()
            }
            host_protocol::SAFE_STORAGE_IS_AVAILABLE_METHOD => linux::safe_storage_is_available(),
            host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD => {
                return self.dispatch_realtime_media_session(
                    RealtimeMediaDispatch {
                        id,
                        trace_id,
                        window_id,
                        payload,
                        timestamp,
                    },
                    realtime_media_session::open_with_events,
                );
            }
            host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD => {
                return self.dispatch_realtime_media_session(
                    RealtimeMediaDispatch {
                        id,
                        trace_id,
                        window_id,
                        payload,
                        timestamp,
                    },
                    realtime_media_session::close_with_events,
                );
            }
            host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD => {
                return self.dispatch_realtime_media_session(
                    RealtimeMediaDispatch {
                        id,
                        trace_id,
                        window_id,
                        payload,
                        timestamp,
                    },
                    realtime_media_session::select_device_with_events,
                );
            }
            host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD => {
                return self.dispatch_realtime_media_session(
                    RealtimeMediaDispatch {
                        id,
                        trace_id,
                        window_id,
                        payload,
                        timestamp,
                    },
                    realtime_media_session::interrupt_with_events,
                );
            }
            host_protocol::REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD => {
                realtime_media_session::is_supported()
            }
            host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD => {
                diagnostics_bundle::collect(payload)
            }
            host_protocol::DIAGNOSTICS_BUNDLE_REDACT_METHOD => diagnostics_bundle::redact(payload),
            host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD => diagnostics_bundle::write(payload),
            host_protocol::DIAGNOSTICS_BUNDLE_IS_SUPPORTED_METHOD => {
                diagnostics_bundle::is_supported()
            }
            host_protocol::EGRESS_POLICY_DECIDE_METHOD => egress_policy::decide(payload),
            host_protocol::EGRESS_POLICY_IS_SUPPORTED_METHOD => egress_policy::is_supported(),
            host_protocol::EXECUTION_SANDBOX_CREATE_METHOD => execution_sandbox::create(payload),
            host_protocol::EXECUTION_SANDBOX_RUN_METHOD => execution_sandbox::run(payload),
            host_protocol::EXECUTION_SANDBOX_DESTROY_METHOD => execution_sandbox::destroy(payload),
            host_protocol::EXECUTION_SANDBOX_IS_SUPPORTED_METHOD => {
                execution_sandbox::is_supported()
            }
            host_protocol::EXTENSION_CONFIG_READ_METHOD => {
                return self.dispatch_extension_config(
                    ExtensionConfigDispatch {
                        id,
                        trace_id,
                        window_id,
                        payload,
                        timestamp,
                    },
                    extension_config::read_with_event,
                );
            }
            host_protocol::EXTENSION_CONFIG_WRITE_METHOD => {
                return self.dispatch_extension_config(
                    ExtensionConfigDispatch {
                        id,
                        trace_id,
                        window_id,
                        payload,
                        timestamp,
                    },
                    extension_config::write_with_event,
                );
            }
            host_protocol::EXTENSION_CONFIG_RESET_METHOD => {
                return self.dispatch_extension_config(
                    ExtensionConfigDispatch {
                        id,
                        trace_id,
                        window_id,
                        payload,
                        timestamp,
                    },
                    extension_config::reset_with_event,
                );
            }
            host_protocol::EXTENSION_CONFIG_REDACT_METHOD => {
                return self.dispatch_extension_config(
                    ExtensionConfigDispatch {
                        id,
                        trace_id,
                        window_id,
                        payload,
                        timestamp,
                    },
                    extension_config::redact_with_event,
                );
            }
            host_protocol::EXTENSION_CONFIG_IS_SUPPORTED_METHOD => extension_config::is_supported(),
            host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD => extension_package::install(payload),
            host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD => extension_package::update(payload),
            host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD => extension_package::remove(payload),
            host_protocol::EXTENSION_PACKAGE_LIST_METHOD => extension_package::list(),
            host_protocol::EXTENSION_PACKAGE_IS_SUPPORTED_METHOD => {
                extension_package::is_supported()
            }
            host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD => {
                local_tool_runtime::register(payload)
            }
            host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD => local_tool_runtime::run(payload),
            host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD => local_tool_runtime::stop(payload),
            host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD => local_tool_runtime::health(payload),
            host_protocol::LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD => {
                local_tool_runtime::is_supported()
            }
            host_protocol::WORKSPACE_INDEX_OPEN_METHOD => workspace_index::open(payload),
            host_protocol::WORKSPACE_INDEX_REFRESH_METHOD => workspace_index::refresh(payload),
            host_protocol::WORKSPACE_INDEX_CLOSE_METHOD => workspace_index::close(payload),
            host_protocol::WORKSPACE_INDEX_IS_SUPPORTED_METHOD => workspace_index::is_supported(),
            host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD => {
                transactional_file_mutation::prepare(payload)
            }
            host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD => {
                transactional_file_mutation::commit(payload)
            }
            host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD => {
                transactional_file_mutation::rollback(payload)
            }
            host_protocol::TRANSACTIONAL_FILE_MUTATION_IS_SUPPORTED_METHOD => {
                transactional_file_mutation::is_supported()
            }
            host_protocol::MENU_SET_APPLICATION_MENU_METHOD => {
                menu::set_application_menu(&*self.window, payload)
            }
            host_protocol::MENU_SET_WINDOW_MENU_METHOD => {
                menu::set_window_menu(&*self.window, payload)
            }
            _ => Err(HostProtocolError::method_not_found(method.clone())),
        };

        let (payload, error) = match result {
            Ok(payload) => (payload, None),
            Err(error) => (None, Some(error)),
        };

        vec![HostProtocolEnvelope::Response {
            id,
            timestamp,
            trace_id,
            payload,
            error,
        }]
    }

    fn dispatch_realtime_media_session(
        &self,
        request: RealtimeMediaDispatch,
        handler: RealtimeMediaHandler,
    ) -> Vec<HostProtocolEnvelope> {
        let (payload, events, error) = match handler(
            &request.id,
            request.payload,
            request.timestamp,
            request.window_id.as_deref(),
            self.runtime_event_sender
                .lock()
                .ok()
                .and_then(|sender| sender.clone()),
            self.runtime_session_failure_sender
                .lock()
                .ok()
                .and_then(|sender| sender.clone()),
        ) {
            Ok((payload, events)) => (payload, events, None),
            Err(error) => (None, Vec::new(), Some(error)),
        };

        let mut frames = events
            .into_iter()
            .map(|(event_method, payload)| HostProtocolEnvelope::Event {
                method: event_method.to_string(),
                timestamp: request.timestamp,
                trace_id: request.trace_id.clone(),
                window_id: request.window_id.clone(),
                payload: Some(payload),
            })
            .collect::<Vec<_>>();
        frames.push(HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id.clone(),
            payload,
            error,
        });
        frames
    }

    fn dispatch_extension_config(
        &self,
        request: ExtensionConfigDispatch,
        handler: ExtensionConfigHandler,
    ) -> Vec<HostProtocolEnvelope> {
        let (payload, event_payload, error) = match handler(request.payload, request.timestamp) {
            Ok((payload, event_payload)) => (payload, event_payload, None),
            Err(error) => (None, None, Some(error)),
        };

        let response = HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id.clone(),
            payload,
            error,
        };

        match event_payload {
            Some(payload) => vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_CONFIG_EVENT.to_string(),
                    timestamp: request.timestamp,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: Some(payload),
                },
                response,
            ],
            None => vec![response],
        }
    }
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after Unix epoch")
        .as_millis()
        .try_into()
        .expect("timestamp milliseconds should fit in u64")
}

fn decode_window_destroy_id(payload: Option<serde_json::Value>) -> Option<String> {
    payload
        .and_then(|payload| {
            serde_json::from_value::<host_protocol::WindowDestroyPayload>(payload).ok()
        })
        .map(|payload| payload.window_id().to_string())
}

#[cfg(test)]
mod tests {
    use super::HostMethodRouter;
    use crate::window::{WindowCreateRequest, WindowMethodHandler};
    use host_protocol::{
        HostProtocolEnvelope, HostProtocolError, WindowCreateResponse, PROTOCOL_VERSION,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn ping_returns_response_with_matching_id_and_trace() {
        let response = test_router()
            .dispatch_at(request("request-ping", "host.ping"), 1710000000100)
            .expect("ping should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-ping".to_string(),
                timestamp: 1710000000100,
                trace_id: "trace-request-ping".to_string(),
                payload: None,
                error: None,
            }
        );
    }

    #[test]
    fn version_returns_protocol_version_payload() {
        let response = test_router()
            .dispatch_at(request("request-version", "host.version"), 1710000000101)
            .expect("version should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-version".to_string(),
                timestamp: 1710000000101,
                trace_id: "trace-request-version".to_string(),
                payload: Some(serde_json::json!({
                    "protocolVersion": PROTOCOL_VERSION
                })),
                error: None,
            }
        );
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let response = test_router()
            .dispatch_at(request("request-missing", "host.missing"), 1710000000102)
            .expect("unknown request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-missing".to_string(),
                timestamp: 1710000000102,
                trace_id: "trace-request-missing".to_string(),
                payload: None,
                error: Some(HostProtocolError::method_not_found("host.missing")),
            }
        );
    }

    #[test]
    fn non_request_envelopes_do_not_dispatch() {
        let response = test_router().dispatch_at(
            HostProtocolEnvelope::Event {
                method: "runtime.ready".to_string(),
                timestamp: 1710000000103,
                trace_id: "trace-event".to_string(),
                window_id: None,
                payload: None,
            },
            1710000000104,
        );

        assert_eq!(response, None);
    }

    #[test]
    fn window_create_validates_payload_and_returns_window_id() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-1")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());
        let response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-create",
                    host_protocol::WINDOW_CREATE_METHOD,
                    serde_json::json!({
                        "title": "Test",
                        "width": 320.0,
                        "height": 240.0
                    }),
                ),
                1710000000105,
            )
            .expect("window create should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-window-create".to_string(),
                timestamp: 1710000000105,
                trace_id: "trace-request-window-create".to_string(),
                payload: Some(serde_json::json!({
                    "windowId": "window-1"
                })),
                error: None,
            }
        );
        assert_eq!(
            fake.created(),
            vec![WindowCreateRequest::new("Test".to_string(), 320.0, 240.0)
                .expect("test request should validate")]
        );
    }

    #[test]
    fn window_create_invalid_bounds_returns_invalid_argument() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-window-create-invalid",
                    host_protocol::WINDOW_CREATE_METHOD,
                    serde_json::json!({
                        "width": 0.0,
                        "height": 240.0
                    }),
                ),
                1710000000106,
            )
            .expect("window create should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-window-create-invalid".to_string(),
                timestamp: 1710000000106,
                trace_id: "trace-request-window-create-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "width",
                    "must be a finite positive number",
                    host_protocol::WINDOW_CREATE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn window_destroy_unknown_id_returns_not_found() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Err(HostProtocolError::not_found(
                "Window:missing",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
        ));
        let router = HostMethodRouter::new(fake);
        let response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-destroy",
                    host_protocol::WINDOW_DESTROY_METHOD,
                    serde_json::json!({
                        "windowId": "missing"
                    }),
                ),
                1710000000107,
            )
            .expect("window destroy should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-window-destroy".to_string(),
                timestamp: 1710000000107,
                trace_id: "trace-request-window-destroy".to_string(),
                payload: None,
                error: Some(HostProtocolError::not_found(
                    "Window:missing",
                    host_protocol::WINDOW_DESTROY_METHOD,
                )),
            }
        );
    }

    #[test]
    fn dock_set_badge_text_routes_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());
        let response = router
            .dispatch_at(
                request_with_payload(
                    "request-dock-badge",
                    host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
                    serde_json::json!({
                        "text": "7"
                    }),
                ),
                1710000000108,
            )
            .expect("dock badge request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-dock-badge".to_string(),
                timestamp: 1710000000108,
                trace_id: "trace-request-dock-badge".to_string(),
                payload: None,
                error: None,
            }
        );
        assert_eq!(fake.dock_badge_labels(), vec![Some("7".to_string())]);
    }

    #[test]
    fn dock_set_badge_text_rejects_ascii_control_characters() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-dock-badge",
                    host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
                    serde_json::json!({
                        "text": "line\nbreak"
                    }),
                ),
                1710000000112,
            )
            .expect("dock badge request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-dock-badge".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-dock-badge".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "text",
                    "must not include control characters",
                    host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
                )),
            }
        );
    }

    #[test]
    fn dock_is_supported_returns_platform_capability_payload() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-dock-supported",
                    host_protocol::DOCK_IS_SUPPORTED_METHOD,
                    serde_json::json!({
                        "method": "setBadgeText"
                    }),
                ),
                1710000000109,
            )
            .expect("dock support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-dock-supported".to_string(),
                timestamp: 1710000000109,
                trace_id: "trace-request-dock-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": cfg!(target_os = "macos")
                })),
                error: None,
            }
        );
    }

    #[test]
    fn global_shortcut_is_registered_returns_false_until_adapter_is_connected() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-global-shortcut-registered",
                    host_protocol::GLOBAL_SHORTCUT_IS_REGISTERED_METHOD,
                ),
                1710000000110,
            )
            .expect("global shortcut support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-global-shortcut-registered".to_string(),
                timestamp: 1710000000110,
                trace_id: "trace-request-global-shortcut-registered".to_string(),
                payload: Some(serde_json::json!({ "registered": false })),
                error: None,
            }
        );
    }

    #[test]
    fn safe_storage_is_available_returns_boolean_payload() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-safe-storage-available",
                    host_protocol::SAFE_STORAGE_IS_AVAILABLE_METHOD,
                ),
                1710000000111,
            )
            .expect("safe storage availability request should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: Some(payload),
                error: None,
            } => {
                assert_eq!(id, "request-safe-storage-available");
                assert_eq!(timestamp, 1710000000111);
                assert_eq!(trace_id, "trace-request-safe-storage-available");
                assert!(payload
                    .get("available")
                    .and_then(serde_json::Value::as_bool)
                    .is_some());
            }
            other => panic!("unexpected safe storage response: {other:?}"),
        }
    }

    #[test]
    fn realtime_media_session_known_methods_route_to_host_adapter() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-realtime-media-close",
                    host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
                    serde_json::json!({
                        "profileId": "profile-1",
                        "sessionId": "session-1"
                    }),
                ),
                1710000000113,
            )
            .expect("realtime media close should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: None,
                error: Some(error),
            } => {
                assert_eq!(id, "request-realtime-media-close");
                assert_eq!(timestamp, 1710000000113);
                assert_eq!(trace_id, "trace-request-realtime-media-close");
                if cfg!(target_os = "macos") {
                    assert_eq!(error.tag(), "NotFound");
                } else {
                    assert_eq!(error.tag(), "Unsupported");
                }
            }
            other => panic!("unexpected realtime media close response: {other:?}"),
        }
    }

    #[test]
    fn realtime_media_session_rejects_invalid_payload_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-realtime-media-invalid",
                    host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
                    serde_json::json!({
                        "profileId": "",
                        "sessionId": "session-1"
                    }),
                ),
                1710000000114,
            )
            .expect("realtime media request should return response");

        match response {
            HostProtocolEnvelope::Response {
                error: Some(error), ..
            } => assert_eq!(error.tag(), "InvalidArgument"),
            other => panic!("unexpected realtime media invalid response: {other:?}"),
        }
    }

    #[test]
    fn realtime_media_session_is_supported_reports_runtime_probe_result() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-realtime-media-supported",
                    host_protocol::REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD,
                ),
                1710000000115,
            )
            .expect("realtime media support request should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: Some(payload),
                error: None,
            } => {
                assert_eq!(id, "request-realtime-media-supported");
                assert_eq!(timestamp, 1710000000115);
                assert_eq!(trace_id, "trace-request-realtime-media-supported");
                assert!(payload
                    .get("supported")
                    .and_then(serde_json::Value::as_bool)
                    .is_some());
                if payload.get("supported") == Some(&serde_json::Value::Bool(false)) {
                    assert!(matches!(
                        payload.get("reason").and_then(serde_json::Value::as_str),
                        Some(host_protocol::REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON)
                            | Some(host_protocol::REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON)
                    ));
                }
            }
            other => panic!("unexpected realtime media support response: {other:?}"),
        }
    }

    #[test]
    fn diagnostics_bundle_collect_returns_summary_payload() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-diagnostics-router-collect",
                    host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
                    serde_json::json!({
                        "bundleId": "bundle-router-collect",
                        "sources": ["logs", "audit-events"]
                    }),
                ),
                1710000000116,
            )
            .expect("diagnostics request should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: Some(payload),
                error: None,
            } => {
                assert_eq!(id, "request-diagnostics-router-collect");
                assert_eq!(timestamp, 1710000000116);
                assert_eq!(trace_id, "trace-request-diagnostics-router-collect");
                assert_eq!(payload["bundleId"], "bundle-router-collect");
                assert_eq!(payload["artifactCount"], 2);
                assert_eq!(payload["sources"][0]["source"], "logs");
                assert_eq!(
                    payload["sources"][0]["redactionPolicy"]["id"],
                    "host-secret-patterns"
                );
            }
            other => panic!("unexpected diagnostics collect response: {other:?}"),
        }
    }

    #[test]
    fn diagnostics_bundle_rejects_invalid_payload() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-diagnostics-invalid",
                    host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
                    serde_json::json!({
                        "bundleId": "bundle-1",
                        "destinationPath": ""
                    }),
                ),
                1710000000117,
            )
            .expect("diagnostics request should return response");

        match response {
            HostProtocolEnvelope::Response {
                error: Some(error), ..
            } => assert_eq!(error.tag(), "InvalidArgument"),
            other => panic!("unexpected diagnostics invalid response: {other:?}"),
        }
    }

    #[test]
    fn diagnostics_bundle_is_supported_reports_host_exporter_support() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-diagnostics-supported",
                    host_protocol::DIAGNOSTICS_BUNDLE_IS_SUPPORTED_METHOD,
                ),
                1710000000118,
            )
            .expect("diagnostics support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-diagnostics-supported".to_string(),
                timestamp: 1710000000118,
                trace_id: "trace-request-diagnostics-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": true
                })),
                error: None,
            }
        );
    }

    #[test]
    fn diagnostics_bundle_router_collect_write_persists_source_records() {
        let router = test_router();
        let bundle_id = "bundle-router-write";
        let dir = unique_temp_dir("diagnostics-router-write");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let path = dir.join("diagnostics.json");

        let collect = router
            .dispatch_at(
                request_with_payload(
                    "request-diagnostics-router-real-collect",
                    host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
                    serde_json::json!({
                        "bundleId": bundle_id,
                        "sources": ["host-state", "logs"],
                        "traceId": "trace-diagnostics-router"
                    }),
                ),
                1710000000119,
            )
            .expect("diagnostics collect should return response");
        assert!(matches!(
            collect,
            HostProtocolEnvelope::Response { error: None, .. }
        ));

        let write = router
            .dispatch_at(
                request_with_payload(
                    "request-diagnostics-router-real-write",
                    host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
                    serde_json::json!({
                        "bundleId": bundle_id,
                        "destinationPath": path.to_string_lossy()
                    }),
                ),
                1710000000120,
            )
            .expect("diagnostics write should return response");
        assert!(matches!(
            write,
            HostProtocolEnvelope::Response { error: None, .. }
        ));

        let body = fs::read_to_string(path).expect("bundle file should exist");
        assert!(!body.contains("metadata-only"));
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("bundle should be JSON");
        assert_eq!(parsed["bundleId"], bundle_id);
        assert_eq!(parsed["artifacts"]["host-state"]["status"], "collected");
        assert_eq!(parsed["artifacts"]["logs"]["status"], "unavailable");
        assert_eq!(
            parsed["artifacts"]["logs"]["unavailable"]["reason"],
            "collector-unavailable"
        );
    }

    #[test]
    fn egress_policy_decide_routes_to_host_adapter() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-egress-policy",
                    host_protocol::EGRESS_POLICY_DECIDE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "destination": {
                            "protocol": "https",
                            "host": "api.example.test",
                            "port": 443
                        },
                        "traceId": "trace-egress-policy"
                    }),
                ),
                1710000000119,
            )
            .expect("egress policy request should return response");

        let decision_id = egress_policy_decision_id(&response);
        assert!(decision_id.starts_with("egress-decision-"));
        assert_ne!(decision_id, "trace-egress-policy");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-egress-policy".to_string(),
                timestamp: 1710000000119,
                trace_id: "trace-request-egress-policy".to_string(),
                payload: Some(serde_json::json!({
                    "decisionId": decision_id,
                    "outcome": "denied",
                    "actor": { "kind": "extension", "id": "extension-1" },
                    "destination": {
                        "protocol": "https",
                        "host": "api.example.test",
                        "port": 443
                    },
                    "rule": {
                        "id": "default-deny",
                        "effect": "deny",
                        "hosts": ["*"],
                        "reason": "no matching egress allow rule"
                    },
                    "reason": "no matching egress allow rule"
                })),
                error: None,
            }
        );
    }

    #[test]
    fn egress_policy_invalid_payload_returns_invalid_argument() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-egress-policy-invalid",
                    host_protocol::EGRESS_POLICY_DECIDE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "destination": {
                            "protocol": "https",
                            "host": ""
                        }
                    }),
                ),
                1710000000120,
            )
            .expect("egress policy request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-egress-policy-invalid".to_string(),
                timestamp: 1710000000120,
                trace_id: "trace-request-egress-policy-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "destination.host",
                    "must be non-empty",
                    host_protocol::EGRESS_POLICY_DECIDE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn egress_policy_record_routes_response_and_native_event() {
        let _guard = super::egress_policy::EGRESS_POLICY_ENV_LOCK
            .lock()
            .expect("egress policy env lock should not be poisoned");
        let dir = unique_temp_dir("egress-policy-record-route");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let log_path = dir.join("egress-policy.jsonl");
        let previous_log_path = std::env::var_os("EFFECT_DESKTOP_EGRESS_POLICY_LOG");
        std::env::set_var("EFFECT_DESKTOP_EGRESS_POLICY_LOG", &log_path);

        let router = test_router();
        let decision_response = router
            .dispatch_at(
                request_with_payload(
                    "request-egress-policy-issue",
                    host_protocol::EGRESS_POLICY_DECIDE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "destination": {
                            "protocol": "https",
                            "host": "api.example.test",
                            "port": 443
                        },
                        "traceId": "decision-router-record"
                    }),
                ),
                1710000000121,
            )
            .expect("egress policy decision should be issued");
        let decision_id = egress_policy_decision_id(&decision_response);

        let frames = router.dispatch_frames_at(
            request_with_payload(
                "request-egress-policy-record",
                host_protocol::EGRESS_POLICY_RECORD_METHOD,
                serde_json::json!({
                    "decisionId": decision_id,
                    "actor": { "kind": "extension", "id": "extension-1" },
                    "destination": {
                        "protocol": "https",
                        "host": "api.example.test",
                        "port": 443
                    },
                    "traceId": "trace-record"
                }),
            ),
            1710000000122,
        );

        match previous_log_path {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_EGRESS_POLICY_LOG", path),
            None => std::env::remove_var("EFFECT_DESKTOP_EGRESS_POLICY_LOG"),
        }

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EGRESS_POLICY_DECISION_RECORDED_EVENT.to_string(),
                    timestamp: 1710000000122,
                    trace_id: "trace-request-egress-policy-record".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                    "type": "decision-recorded",
                    "timestamp": 1_710_000_000_122_u64,
                        "decision": {
                            "decisionId": decision_id,
                            "outcome": "denied",
                            "actor": { "kind": "extension", "id": "extension-1" },
                            "destination": {
                                "protocol": "https",
                            "host": "api.example.test",
                            "port": 443
                            },
                            "rule": {
                                "id": "default-deny",
                                "effect": "deny",
                                "hosts": ["*"],
                                "reason": "no matching egress allow rule"
                            },
                            "reason": "no matching egress allow rule"
                        }
                    })),
                },
                HostProtocolEnvelope::Response {
                    id: "request-egress-policy-record".to_string(),
                    timestamp: 1710000000122,
                    trace_id: "trace-request-egress-policy-record".to_string(),
                    payload: Some(serde_json::json!({
                        "decisionId": decision_id,
                        "recorded": true
                    })),
                    error: None,
                },
            ]
        );
        assert!(log_path.exists());

        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn execution_sandbox_create_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-execution-sandbox-create",
                    host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
                    execution_sandbox_create_payload(),
                ),
                1710000000121,
            )
            .expect("execution sandbox request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-execution-sandbox-create".to_string(),
                timestamp: 1710000000121,
                trace_id: "trace-request-execution-sandbox-create".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON,
                    host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn execution_sandbox_invalid_payload_returns_invalid_argument_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-execution-sandbox-invalid",
                    host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "policy": {
                            "cwd": "/tmp/app",
                            "budgets": {
                                "cpuMillis": 0,
                                "memoryBytes": 67108864,
                                "wallClockMillis": 1000,
                                "stdoutBytes": 1024,
                                "stderrBytes": 1024
                            },
                            "cleanup": {
                                "killProcessTree": true,
                                "removeWorkingDirectory": true
                            }
                        }
                    }),
                ),
                1710000000122,
            )
            .expect("execution sandbox request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-execution-sandbox-invalid".to_string(),
                timestamp: 1710000000122,
                trace_id: "trace-request-execution-sandbox-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "policy.budgets.cpuMillis",
                    "must be greater than zero",
                    host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn execution_sandbox_is_supported_reports_unimplemented_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-execution-sandbox-supported",
                    host_protocol::EXECUTION_SANDBOX_IS_SUPPORTED_METHOD,
                ),
                1710000000123,
            )
            .expect("execution sandbox support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-execution-sandbox-supported".to_string(),
                timestamp: 1710000000123,
                trace_id: "trace-request-execution-sandbox-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
    }

    #[test]
    fn extension_config_read_routes_response_and_native_event() {
        let _guard = super::extension_config::EXTENSION_CONFIG_ENV_LOCK
            .lock()
            .expect("extension config env lock should not be poisoned");
        let dir = unique_temp_dir("extension-config-read-route");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let store_path = dir.join("extension-config.json");
        let previous_store_path = std::env::var_os("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE");
        std::env::set_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE", &store_path);

        let frames = test_router().dispatch_frames_at(
            request_with_payload(
                "request-extension-config-read",
                host_protocol::EXTENSION_CONFIG_READ_METHOD,
                extension_config_read_payload(),
            ),
            1710000000124,
        );

        match previous_store_path {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE"),
        }
        let _ = fs::remove_dir_all(dir);

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_CONFIG_EVENT.to_string(),
                    timestamp: 1710000000124,
                    trace_id: "trace-request-extension-config-read".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                        "type": "extension-config-event",
                        "timestamp": 1_710_000_000_124_u64,
                        "extensionId": "extension-1",
                        "phase": "read",
                        "keys": ["theme", "apiKey"],
                        "revision": 0
                    })),
                },
                HostProtocolEnvelope::Response {
                    id: "request-extension-config-read".to_string(),
                    timestamp: 1710000000124,
                    trace_id: "trace-request-extension-config-read".to_string(),
                    payload: Some(serde_json::json!({
                        "extensionId": "extension-1",
                        "values": [{ "key": "theme", "value": "light" }],
                        "secrets": [{ "key": "apiKey", "present": false }],
                        "revision": 0
                    })),
                    error: None,
                },
            ]
        );
    }

    #[test]
    fn extension_config_invalid_payload_returns_invalid_argument_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-extension-config-invalid",
                    host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "extensionId": "extension-1",
                        "fields": [{ "key": "enabled", "valueType": "boolean", "secret": false }],
                        "values": [{ "key": "enabled", "value": "yes" }]
                    }),
                ),
                1710000000125,
            )
            .expect("extension config request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-config-invalid".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-extension-config-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "values.value",
                    "does not match declared field type",
                    host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn extension_config_is_supported_reports_store_availability() {
        let _guard = super::extension_config::EXTENSION_CONFIG_ENV_LOCK
            .lock()
            .expect("extension config env lock should not be poisoned");
        let dir = unique_temp_dir("extension-config-supported-route");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let store_path = dir.join("extension-config.json");
        let previous_store_path = std::env::var_os("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE");
        std::env::set_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE", &store_path);

        let response = test_router()
            .dispatch_at(
                request(
                    "request-extension-config-supported",
                    host_protocol::EXTENSION_CONFIG_IS_SUPPORTED_METHOD,
                ),
                1710000000126,
            )
            .expect("extension config support request should return response");

        match previous_store_path {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE"),
        }
        let _ = fs::remove_dir_all(dir);

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-config-supported".to_string(),
                timestamp: 1710000000126,
                trace_id: "trace-request-extension-config-supported".to_string(),
                payload: Some(serde_json::json!({ "supported": true })),
                error: None,
            }
        );
    }

    #[test]
    fn extension_package_install_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-extension-package-install",
                    host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
                    extension_package_install_payload(),
                ),
                1710000000127,
            )
            .expect("extension package request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-package-install".to_string(),
                timestamp: 1710000000127,
                trace_id: "trace-request-extension-package-install".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::EXTENSION_PACKAGE_UNSUPPORTED_REASON,
                    host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
                )),
            }
        );
    }

    #[test]
    fn extension_package_invalid_payload_returns_invalid_argument_before_unsupported() {
        let mut payload = extension_package_install_payload();
        payload["manifest"]["entrypoint"] = serde_json::json!("../escape.js");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-extension-package-invalid",
                    host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
                    payload,
                ),
                1710000000128,
            )
            .expect("extension package request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-package-invalid".to_string(),
                timestamp: 1710000000128,
                trace_id: "trace-request-extension-package-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "manifest.entrypoint",
                    "must stay inside the package",
                    host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
                )),
            }
        );
    }

    #[test]
    fn extension_package_is_supported_reports_unimplemented_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-extension-package-supported",
                    host_protocol::EXTENSION_PACKAGE_IS_SUPPORTED_METHOD,
                ),
                1710000000129,
            )
            .expect("extension package support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-package-supported".to_string(),
                timestamp: 1710000000129,
                trace_id: "trace-request-extension-package-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::EXTENSION_PACKAGE_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
    }

    #[test]
    fn local_tool_runtime_register_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-local-tool-runtime-register",
                    host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                    local_tool_runtime_register_payload(),
                ),
                1710000000130,
            )
            .expect("local tool runtime request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-local-tool-runtime-register".to_string(),
                timestamp: 1710000000130,
                trace_id: "trace-request-local-tool-runtime-register".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON,
                    host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                )),
            }
        );
    }

    #[test]
    fn local_tool_runtime_invalid_payload_returns_invalid_argument_before_unsupported() {
        let mut payload = local_tool_runtime_register_payload();
        payload["manifest"]["commands"][0]["executable"] = serde_json::json!("/usr/bin/node;rm");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-local-tool-runtime-invalid",
                    host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                    payload,
                ),
                1710000000131,
            )
            .expect("local tool runtime request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-local-tool-runtime-invalid".to_string(),
                timestamp: 1710000000131,
                trace_id: "trace-request-local-tool-runtime-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "manifest.commands.executable",
                    "contains shell metacharacters",
                    host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                )),
            }
        );
    }

    #[test]
    fn local_tool_runtime_is_supported_reports_unimplemented_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-local-tool-runtime-supported",
                    host_protocol::LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD,
                ),
                1710000000132,
            )
            .expect("local tool runtime support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-local-tool-runtime-supported".to_string(),
                timestamp: 1710000000132,
                trace_id: "trace-request-local-tool-runtime-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
    }

    #[test]
    fn workspace_index_open_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-workspace-index-open",
                    host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
                    workspace_index_open_payload(),
                ),
                1710000000133,
            )
            .expect("workspace index request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-workspace-index-open".to_string(),
                timestamp: 1710000000133,
                trace_id: "trace-request-workspace-index-open".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::WORKSPACE_INDEX_UNSUPPORTED_REASON,
                    host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
                )),
            }
        );
    }

    #[test]
    fn workspace_index_invalid_payload_returns_invalid_argument_before_unsupported() {
        let mut payload = workspace_index_open_payload();
        payload["scope"]["root"] = serde_json::json!("workspace/app");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-workspace-index-invalid",
                    host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
                    payload,
                ),
                1710000000134,
            )
            .expect("workspace index request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-workspace-index-invalid".to_string(),
                timestamp: 1710000000134,
                trace_id: "trace-request-workspace-index-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "scope.root",
                    "must be an absolute path",
                    host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
                )),
            }
        );
    }

    #[test]
    fn workspace_index_is_supported_reports_unimplemented_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-workspace-index-supported",
                    host_protocol::WORKSPACE_INDEX_IS_SUPPORTED_METHOD,
                ),
                1710000000135,
            )
            .expect("workspace index support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-workspace-index-supported".to_string(),
                timestamp: 1710000000135,
                trace_id: "trace-request-workspace-index-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::WORKSPACE_INDEX_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
    }

    #[test]
    fn transactional_file_mutation_prepare_routes_to_supported_adapter() {
        let path = temp_file("transactional-file-mutation-route", b"source\n");
        let mut payload = transactional_file_mutation_prepare_payload();
        payload["path"] = serde_json::json!(path.display().to_string());
        payload["expectedSourceHash"] = serde_json::json!("fnv1a-991ed596");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-file-mutation-prepare",
                    host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
                    payload,
                ),
                1710000000136,
            )
            .expect("transactional file mutation request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-file-mutation-prepare".to_string(),
                timestamp: 1710000000136,
                trace_id: "trace-request-file-mutation-prepare".to_string(),
                payload: Some(serde_json::json!({
                    "mutationId": "file-mutation-1",
                    "path": path.display().to_string(),
                    "state": "prepared",
                    "ownerScope": "transactional-file-mutation-workspace-workspace-1",
                    "sourceHash": "fnv1a-991ed596",
                    "replacementHash": "fnv1a-d5615ac6",
                    "diff": {
                        "format": "unified",
                        "text": format!(
                            "--- {}\n+++ {}\n@@ -1,2 +1,2 @@\n-source\n-\n+next\n+",
                            path.display(),
                            path.display()
                        ),
                        "additions": 2,
                        "deletions": 2
                    }
                })),
                error: None,
            }
        );
        let _ = test_router().dispatch_at(
            request_with_payload(
                "request-file-mutation-cleanup",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
                serde_json::json!({
                    "actor": { "kind": "workspace", "id": "workspace-1" },
                    "mutationId": "file-mutation-1"
                }),
            ),
            1710000000139,
        );
        cleanup_path(path);
    }

    #[test]
    fn transactional_file_mutation_invalid_payload_returns_invalid_argument_before_host_work() {
        let mut payload = transactional_file_mutation_prepare_payload();
        payload["path"] = serde_json::json!("workspace/app/src/main.ts");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-file-mutation-invalid",
                    host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
                    payload,
                ),
                1710000000137,
            )
            .expect("transactional file mutation request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-file-mutation-invalid".to_string(),
                timestamp: 1710000000137,
                trace_id: "trace-request-file-mutation-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "path",
                    "must be an absolute path",
                    host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn transactional_file_mutation_is_supported_reports_supported_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-file-mutation-supported",
                    host_protocol::TRANSACTIONAL_FILE_MUTATION_IS_SUPPORTED_METHOD,
                ),
                1710000000138,
            )
            .expect("transactional file mutation support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-file-mutation-supported".to_string(),
                timestamp: 1710000000138,
                trace_id: "trace-request-file-mutation-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": true
                })),
                error: None,
            }
        );
    }

    fn request(id: &str, method: &str) -> HostProtocolEnvelope {
        request_with_payload(id, method, serde_json::Value::Null)
    }

    fn request_with_payload(
        id: &str,
        method: &str,
        payload: serde_json::Value,
    ) -> HostProtocolEnvelope {
        HostProtocolEnvelope::Request {
            id: id.to_string(),
            method: method.to_string(),
            timestamp: 1710000000000,
            trace_id: format!("trace-{id}"),
            window_id: None,
            origin_token: None,
            payload: if payload.is_null() {
                None
            } else {
                Some(payload)
            },
        }
    }

    fn test_router() -> HostMethodRouter {
        HostMethodRouter::new(Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-test")),
            Ok(()),
        )))
    }

    fn egress_policy_decision_id(response: &HostProtocolEnvelope) -> String {
        let HostProtocolEnvelope::Response {
            payload: Some(payload),
            error: None,
            ..
        } = response
        else {
            panic!("egress policy decision response should be successful");
        };

        payload
            .get("decisionId")
            .and_then(serde_json::Value::as_str)
            .expect("egress policy decision response should include decisionId")
            .to_string()
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("effect-desktop-method-router-{nanos}-{name}"))
    }

    fn execution_sandbox_create_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "policy": {
                "cwd": "/tmp/app",
                "filesystem": {
                    "readRoots": ["/tmp/app"],
                    "writeRoots": ["/tmp/app/out"]
                },
                "network": {
                    "hosts": ["api.example.test"]
                },
                "budgets": {
                    "cpuMillis": 500,
                    "memoryBytes": 67108864,
                    "wallClockMillis": 1000,
                    "stdoutBytes": 1024,
                    "stderrBytes": 1024
                },
                "cleanup": {
                    "killProcessTree": true,
                    "removeWorkingDirectory": true
                }
            },
            "sandboxId": "sandbox-1",
            "traceId": "trace-sandbox"
        })
    }

    fn extension_config_read_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": [
                {
                    "key": "theme",
                    "valueType": "string",
                    "secret": false,
                    "defaultValue": "light"
                },
                { "key": "apiKey", "valueType": "string", "secret": true }
            ],
            "traceId": "trace-extension-config"
        })
    }

    fn extension_package_install_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "source": {
                "kind": "directory",
                "uri": "file:///tmp/extensions/extension-1",
                "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            },
            "manifest": {
                "id": "extension-1",
                "name": "Extension One",
                "version": "1.0.0",
                "entrypoint": "dist/main.js",
                "compatibility": {
                    "minHostVersion": "1.0.0",
                    "maxHostVersion": "2.0.0"
                },
                "capabilities": [
                    {
                        "capability": {
                            "kind": "filesystem.read",
                            "roots": ["/tmp/extensions"],
                            "audit": "always"
                        },
                        "reason": "read extension files"
                    }
                ]
            },
            "traceId": "trace-extension-package"
        })
    }

    fn local_tool_runtime_register_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "manifest": {
                "toolId": "tool-1",
                "name": "Tool One",
                "version": "1.0.0",
                "commands": [
                    {
                        "commandId": "node-version",
                        "executable": "/usr/bin/node",
                        "defaultArgs": ["--version"],
                        "cwd": "/tmp/app",
                        "timeoutMillis": 1000
                    }
                ],
                "permissions": [
                    {
                        "kind": "process.spawn",
                        "commands": ["/usr/bin/node"],
                        "cwd": ["/tmp/app"],
                        "environment": "none",
                        "shell": false,
                        "audit": "always"
                    }
                ],
                "policy": {
                    "cwd": { "roots": ["/tmp/app"] },
                    "environment": { "variables": [] },
                    "filesystem": { "readRoots": ["/tmp/app"] },
                    "network": { "hosts": [] },
                    "budgets": {
                        "cpuMillis": 500,
                        "memoryBytes": 67108864,
                        "wallClockMillis": 1000,
                        "stdoutBytes": 1024,
                        "stderrBytes": 1024
                    },
                    "stdio": { "stdout": "capture", "stderr": "capture" },
                    "cleanup": {
                        "killProcessTree": true,
                        "removeWorkingDirectory": true
                    }
                }
            },
            "runtimeId": "runtime-1",
            "traceId": "trace-local-tool-runtime"
        })
    }

    fn workspace_index_open_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "scope": {
                "root": "/workspace/app",
                "ignoreRules": [
                    { "pattern": "node_modules/**", "reason": "dependencies" }
                ],
                "grants": [
                    {
                        "kind": "filesystem.read",
                        "roots": ["/workspace"],
                        "audit": "always"
                    }
                ],
                "watch": true
            },
            "indexId": "workspace-index-1",
            "traceId": "trace-workspace-index"
        })
    }

    fn transactional_file_mutation_prepare_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": "/workspace/app/src/main.ts",
            "replacementBytes": [110, 101, 120, 116, 10],
            "expectedSourceHash": "fnv1a-source",
            "mutationId": "file-mutation-1",
            "traceId": "trace-file-mutation"
        })
    }

    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("effect-desktop-methods-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let path = dir.join(format!("{name}.txt"));
        fs::write(&path, bytes).expect("temp file should be written");
        path
    }

    fn cleanup_path(path: PathBuf) {
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    struct FakeWindowHandler {
        create_result: Result<WindowCreateResponse, HostProtocolError>,
        destroy_result: Result<(), HostProtocolError>,
        created: Mutex<Vec<WindowCreateRequest>>,
        dock_badge_labels: Mutex<Vec<Option<String>>>,
    }

    impl FakeWindowHandler {
        fn new(
            create_result: Result<WindowCreateResponse, HostProtocolError>,
            destroy_result: Result<(), HostProtocolError>,
        ) -> Self {
            Self {
                create_result,
                destroy_result,
                created: Mutex::new(Vec::new()),
                dock_badge_labels: Mutex::new(Vec::new()),
            }
        }

        fn created(&self) -> Vec<WindowCreateRequest> {
            self.created
                .lock()
                .expect("fake created requests should lock")
                .clone()
        }

        fn dock_badge_labels(&self) -> Vec<Option<String>> {
            self.dock_badge_labels
                .lock()
                .expect("fake dock badge labels should lock")
                .clone()
        }
    }

    impl WindowMethodHandler for FakeWindowHandler {
        fn create(
            &self,
            request: WindowCreateRequest,
        ) -> Result<WindowCreateResponse, HostProtocolError> {
            self.created
                .lock()
                .expect("fake created requests should lock")
                .push(request);
            self.create_result.clone()
        }

        fn destroy(&self, _window_id: &str) -> Result<(), HostProtocolError> {
            self.destroy_result.clone()
        }

        fn set_dock_badge_label(
            &self,
            label: Option<String>,
            _operation: &'static str,
        ) -> Result<(), HostProtocolError> {
            self.dock_badge_labels
                .lock()
                .expect("fake dock badge labels should lock")
                .push(label);
            Ok(())
        }

        fn request_dock_attention(&self, _critical: bool) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_dock_menu(
            &self,
            _template: Option<serde_json::Value>,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_application_menu(
            &self,
            _template: serde_json::Value,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_window_menu(
            &self,
            _window_id: &str,
            _template: serde_json::Value,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }
    }
}

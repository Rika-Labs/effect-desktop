mod diagnostics_bundle;
mod dock;
mod egress_policy;
pub(crate) mod handshake;
mod menu;
mod realtime_media_session;
mod window;

use crate::{linux, window::WindowMethodHandler};
use host_protocol::{HostProtocolEnvelope, HostProtocolError};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub(crate) struct HostMethodRouter {
    window: Arc<dyn WindowMethodHandler>,
}

impl HostMethodRouter {
    pub(crate) fn new(window: Arc<dyn WindowMethodHandler>) -> Self {
        Self { window }
    }

    pub(crate) fn dispatch(&self, envelope: HostProtocolEnvelope) -> Option<HostProtocolEnvelope> {
        self.dispatch_at(envelope, timestamp_millis())
    }

    fn dispatch_at(
        &self,
        envelope: HostProtocolEnvelope,
        timestamp: u64,
    ) -> Option<HostProtocolEnvelope> {
        let HostProtocolEnvelope::Request {
            id,
            method,
            trace_id,
            payload,
            ..
        } = envelope
        else {
            return None;
        };

        let result = match method.as_str() {
            host_protocol::HOST_PING_METHOD => Ok(None),
            host_protocol::HOST_VERSION_METHOD => Ok(Some(handshake::version_payload())),
            host_protocol::WINDOW_CREATE_METHOD => window::create(&*self.window, payload),
            host_protocol::WINDOW_DESTROY_METHOD => window::destroy(&*self.window, payload),
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
                realtime_media_session::open(payload)
            }
            host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD => {
                realtime_media_session::close(payload)
            }
            host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD => {
                realtime_media_session::select_device(payload)
            }
            host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD => {
                realtime_media_session::interrupt(payload)
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
            host_protocol::EGRESS_POLICY_RECORD_METHOD => egress_policy::record(payload),
            host_protocol::EGRESS_POLICY_IS_SUPPORTED_METHOD => egress_policy::is_supported(),
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

        Some(HostProtocolEnvelope::Response {
            id,
            timestamp,
            trace_id,
            payload,
            error,
        })
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

#[cfg(test)]
mod tests {
    use super::HostMethodRouter;
    use crate::window::{WindowCreateRequest, WindowMethodHandler};
    use host_protocol::{
        HostProtocolEnvelope, HostProtocolError, WindowCreateResponse, PROTOCOL_VERSION,
    };
    use std::sync::{Arc, Mutex};

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
    fn realtime_media_session_known_methods_return_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-realtime-media-open",
                    host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
                    serde_json::json!({
                        "profileId": "profile-1",
                        "sessionId": "session-1"
                    }),
                ),
                1710000000113,
            )
            .expect("realtime media request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-realtime-media-open".to_string(),
                timestamp: 1710000000113,
                trace_id: "trace-request-realtime-media-open".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON,
                    host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
                )),
            }
        );
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
    fn realtime_media_session_is_supported_reports_unimplemented_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-realtime-media-supported",
                    host_protocol::REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD,
                ),
                1710000000115,
            )
            .expect("realtime media support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-realtime-media-supported".to_string(),
                timestamp: 1710000000115,
                trace_id: "trace-request-realtime-media-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
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

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-egress-policy".to_string(),
                timestamp: 1710000000119,
                trace_id: "trace-request-egress-policy".to_string(),
                payload: Some(serde_json::json!({
                    "decisionId": "trace-egress-policy",
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

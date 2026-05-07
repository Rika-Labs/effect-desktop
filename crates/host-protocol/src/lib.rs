//! Host-runtime protocol wire types.

mod error;

pub use error::{
    HostProtocolError, HostProtocolErrorSpec, HostProtocolPlatform, HOST_PROTOCOL_ERROR_SPECS,
};

use std::collections::BTreeMap;

use serde::{de, ser, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

pub const HOST_PING_METHOD: &str = "host.ping";
pub const HOST_VERSION_METHOD: &str = "host.version";
pub const PROTOCOL_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const WINDOW_CREATE_METHOD: &str = "Window.create";
pub const WINDOW_DESTROY_METHOD: &str = "Window.destroy";
pub const DOCK_SET_BADGE_COUNT_METHOD: &str = "Dock.setBadgeCount";
pub const DOCK_SET_BADGE_TEXT_METHOD: &str = "Dock.setBadgeText";
pub const DOCK_SET_MENU_METHOD: &str = "Dock.setMenu";
pub const DOCK_REQUEST_ATTENTION_METHOD: &str = "Dock.requestAttention";
pub const MENU_SET_APPLICATION_MENU_METHOD: &str = "Menu.setApplicationMenu";
pub const MENU_SET_WINDOW_MENU_METHOD: &str = "Menu.setWindowMenu";
pub const RENDERER_DISCONNECTED_EVENT: &str = "renderer.disconnected";
pub const RENDERER_RESUME_METHOD: &str = "renderer.resume";
pub const RENDERER_RESUMED_EVENT: &str = "renderer.resumed";
pub const RENDERER_RESUME_DENIED_EVENT: &str = "renderer.resume.denied";
pub const DEFAULT_RECONNECT_WINDOW_MS: u64 = 30_000;
pub const DEFAULT_MAX_BACKFILL_EVENTS: u64 = 1_024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostVersionPayload {
    protocol_version: String,
}

impl HostVersionPayload {
    pub fn current() -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION.to_string(),
        }
    }

    pub fn protocol_version(&self) -> &str {
        &self.protocol_version
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowCreatePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title_bar_style: Option<WindowTitleBarStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vibrancy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    traffic_lights: Option<WindowTrafficLights>,
}

impl WindowCreatePayload {
    pub fn new(title: Option<String>, width: Option<f64>, height: Option<f64>) -> Self {
        Self {
            title,
            width,
            height,
            title_bar_style: None,
            vibrancy: None,
            traffic_lights: None,
        }
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn width(&self) -> Option<f64> {
        self.width
    }

    pub fn height(&self) -> Option<f64> {
        self.height
    }

    pub fn title_bar_style(&self) -> Option<WindowTitleBarStyle> {
        self.title_bar_style
    }

    pub fn vibrancy(&self) -> Option<&str> {
        self.vibrancy.as_deref()
    }

    pub fn traffic_lights(&self) -> Option<&WindowTrafficLights> {
        self.traffic_lights.as_ref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowTitleBarStyle {
    Default,
    Hidden,
    HiddenInset,
    CustomButtonsOnHover,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowTrafficLights {
    x: f64,
    y: f64,
}

impl WindowTrafficLights {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn x(&self) -> f64 {
        self.x
    }

    pub fn y(&self) -> f64 {
        self.y
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowCreateResponse {
    window_id: String,
}

impl WindowCreateResponse {
    pub fn new(window_id: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowDestroyPayload {
    window_id: String,
}

impl WindowDestroyPayload {
    pub fn new(window_id: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeTicket {
    window_id: String,
    origin_token_hash: String,
    resume_nonce: String,
    expires_at: u64,
    last_stream_cursors: BTreeMap<String, String>,
}

impl ResumeTicket {
    pub fn new(
        window_id: impl Into<String>,
        origin_token_hash: impl Into<String>,
        resume_nonce: impl Into<String>,
        expires_at: u64,
        last_stream_cursors: BTreeMap<String, String>,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            origin_token_hash: origin_token_hash.into(),
            resume_nonce: resume_nonce.into(),
            expires_at,
            last_stream_cursors,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn origin_token_hash(&self) -> &str {
        &self.origin_token_hash
    }

    pub fn resume_nonce(&self) -> &str {
        &self.resume_nonce
    }

    pub fn expires_at(&self) -> u64 {
        self.expires_at
    }

    pub fn last_stream_cursors(&self) -> &BTreeMap<String, String> {
        &self.last_stream_cursors
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererDisconnectedPayload {
    window_id: String,
    resume_ticket: ResumeTicket,
}

impl RendererDisconnectedPayload {
    pub fn new(window_id: impl Into<String>, resume_ticket: ResumeTicket) -> Self {
        Self {
            window_id: window_id.into(),
            resume_ticket,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn resume_ticket(&self) -> &ResumeTicket {
        &self.resume_ticket
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererResumePayload {
    window_id: String,
    resume_nonce: String,
    cursors: BTreeMap<String, String>,
}

impl RendererResumePayload {
    pub fn new(
        window_id: impl Into<String>,
        resume_nonce: impl Into<String>,
        cursors: BTreeMap<String, String>,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            resume_nonce: resume_nonce.into(),
            cursors,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn resume_nonce(&self) -> &str {
        &self.resume_nonce
    }

    pub fn cursors(&self) -> &BTreeMap<String, String> {
        &self.cursors
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererResumedPayload {
    window_id: String,
    replayed_stream_ids: Vec<String>,
}

impl RendererResumedPayload {
    pub fn new(window_id: impl Into<String>, replayed_stream_ids: Vec<String>) -> Self {
        Self {
            window_id: window_id.into(),
            replayed_stream_ids,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn replayed_stream_ids(&self) -> &[String] {
        &self.replayed_stream_ids
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RendererResumeDeniedReason {
    Expired,
    WindowMismatch,
    OriginInvalid,
    BackfillExhausted,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererResumeDeniedPayload {
    window_id: String,
    reason: RendererResumeDeniedReason,
    message: String,
}

impl RendererResumeDeniedPayload {
    pub fn new(
        window_id: impl Into<String>,
        reason: RendererResumeDeniedReason,
        message: impl Into<String>,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            reason,
            message: message.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn reason(&self) -> &RendererResumeDeniedReason {
        &self.reason
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum HostProtocolEnvelope {
    Request {
        id: String,
        method: String,
        timestamp: u64,
        trace_id: String,
        window_id: Option<String>,
        origin_token: Option<String>,
        payload: Option<Value>,
    },
    Response {
        id: String,
        timestamp: u64,
        trace_id: String,
        payload: Option<Value>,
        error: Option<HostProtocolError>,
    },
    Event {
        method: String,
        timestamp: u64,
        trace_id: String,
        window_id: Option<String>,
        payload: Option<Value>,
    },
    Stream {
        id: Option<String>,
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
        payload: Option<Value>,
        error: Option<HostProtocolError>,
    },
    Cancel {
        id: Option<String>,
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
    },
}

impl Serialize for HostProtocolEnvelope {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableHostProtocolEnvelope::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for HostProtocolEnvelope {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawHostProtocolEnvelope::deserialize(deserializer)?;
        HostProtocolEnvelope::try_from(raw).map_err(de::Error::custom)
    }
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum SerializableHostProtocolEnvelope<'a> {
    Request {
        id: &'a str,
        method: &'a str,
        timestamp: u64,
        trace_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        window_id: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        origin_token: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<&'a Value>,
    },
    Response {
        id: &'a str,
        timestamp: u64,
        trace_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<&'a Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<&'a HostProtocolError>,
    },
    Event {
        method: &'a str,
        timestamp: u64,
        trace_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        window_id: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<&'a Value>,
    },
    Stream {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource_id: Option<&'a str>,
        timestamp: u64,
        trace_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<&'a Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<&'a HostProtocolError>,
    },
    Cancel {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource_id: Option<&'a str>,
        timestamp: u64,
        trace_id: &'a str,
    },
}

impl<'a> TryFrom<&'a HostProtocolEnvelope> for SerializableHostProtocolEnvelope<'a> {
    type Error = &'static str;

    fn try_from(envelope: &'a HostProtocolEnvelope) -> Result<Self, Self::Error> {
        match envelope {
            HostProtocolEnvelope::Request {
                id,
                method,
                timestamp,
                trace_id,
                window_id,
                origin_token,
                payload,
            } => Ok(Self::Request {
                id,
                method,
                timestamp: *timestamp,
                trace_id,
                window_id: window_id.as_deref(),
                origin_token: origin_token.as_deref(),
                payload: payload.as_ref(),
            }),
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload,
                error,
            } => Ok(Self::Response {
                id,
                timestamp: *timestamp,
                trace_id,
                payload: payload.as_ref(),
                error: error.as_ref(),
            }),
            HostProtocolEnvelope::Event {
                method,
                timestamp,
                trace_id,
                window_id,
                payload,
            } => Ok(Self::Event {
                method,
                timestamp: *timestamp,
                trace_id,
                window_id: window_id.as_deref(),
                payload: payload.as_ref(),
            }),
            HostProtocolEnvelope::Stream {
                id,
                resource_id,
                timestamp,
                trace_id,
                payload,
                error,
            } => {
                if id.is_none() && resource_id.is_none() {
                    return Err("stream envelope requires id or resourceId");
                }

                Ok(Self::Stream {
                    id: id.as_deref(),
                    resource_id: resource_id.as_deref(),
                    timestamp: *timestamp,
                    trace_id,
                    payload: payload.as_ref(),
                    error: error.as_ref(),
                })
            }
            HostProtocolEnvelope::Cancel {
                id,
                resource_id,
                timestamp,
                trace_id,
            } => {
                if id.is_none() && resource_id.is_none() {
                    return Err("cancel envelope requires id or resourceId");
                }

                Ok(Self::Cancel {
                    id: id.as_deref(),
                    resource_id: resource_id.as_deref(),
                    timestamp: *timestamp,
                    trace_id,
                })
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum RawHostProtocolEnvelope {
    Request {
        id: String,
        method: String,
        timestamp: u64,
        trace_id: String,
        window_id: Option<String>,
        origin_token: Option<String>,
        payload: Option<Value>,
    },
    Response {
        id: String,
        timestamp: u64,
        trace_id: String,
        payload: Option<Value>,
        error: Option<HostProtocolError>,
    },
    Event {
        method: String,
        timestamp: u64,
        trace_id: String,
        window_id: Option<String>,
        payload: Option<Value>,
    },
    Stream {
        id: Option<String>,
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
        payload: Option<Value>,
        error: Option<HostProtocolError>,
    },
    Cancel {
        id: Option<String>,
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
    },
}

impl TryFrom<RawHostProtocolEnvelope> for HostProtocolEnvelope {
    type Error = &'static str;

    fn try_from(raw: RawHostProtocolEnvelope) -> Result<Self, Self::Error> {
        match raw {
            RawHostProtocolEnvelope::Request {
                id,
                method,
                timestamp,
                trace_id,
                window_id,
                origin_token,
                payload,
            } => Ok(Self::Request {
                id,
                method,
                timestamp,
                trace_id,
                window_id,
                origin_token,
                payload,
            }),
            RawHostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload,
                error,
            } => Ok(Self::Response {
                id,
                timestamp,
                trace_id,
                payload,
                error,
            }),
            RawHostProtocolEnvelope::Event {
                method,
                timestamp,
                trace_id,
                window_id,
                payload,
            } => Ok(Self::Event {
                method,
                timestamp,
                trace_id,
                window_id,
                payload,
            }),
            RawHostProtocolEnvelope::Stream {
                id,
                resource_id,
                timestamp,
                trace_id,
                payload,
                error,
            } => {
                if id.is_none() && resource_id.is_none() {
                    return Err("stream envelope requires id or resourceId");
                }

                Ok(Self::Stream {
                    id,
                    resource_id,
                    timestamp,
                    trace_id,
                    payload,
                    error,
                })
            }
            RawHostProtocolEnvelope::Cancel {
                id,
                resource_id,
                timestamp,
                trace_id,
            } => {
                if id.is_none() && resource_id.is_none() {
                    return Err("cancel envelope requires id or resourceId");
                }

                Ok(Self::Cancel {
                    id,
                    resource_id,
                    timestamp,
                    trace_id,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        HostProtocolEnvelope, HostProtocolError, HostVersionPayload, RendererResumeDeniedPayload,
        RendererResumeDeniedReason, RendererResumePayload, RendererResumedPayload, ResumeTicket,
        WindowCreatePayload, WindowCreateResponse, WindowDestroyPayload, WindowTitleBarStyle,
        WindowTrafficLights, DEFAULT_MAX_BACKFILL_EVENTS, DEFAULT_RECONNECT_WINDOW_MS,
        HOST_PROTOCOL_ERROR_SPECS, PROTOCOL_VERSION,
    };
    use std::{
        collections::{BTreeMap, BTreeSet},
        fs,
        path::PathBuf,
    };

    const FIXTURE_NAMES: &[&str] = &[
        "request.json",
        "response.json",
        "event.json",
        "renderer-disconnected-event.json",
        "renderer-resume-denied-event.json",
        "renderer-resume-request.json",
        "renderer-resumed-event.json",
        "stream.json",
        "cancel.json",
        "error-response.json",
    ];

    #[test]
    fn shared_fixtures_round_trip_to_canonical_json() {
        for fixture_name in FIXTURE_NAMES {
            let source = read_fixture(fixture_name);
            let envelope: HostProtocolEnvelope =
                serde_json::from_str(&source).expect("fixture should decode");

            assert_eq!(
                serde_json::to_string(&envelope).expect("fixture should encode"),
                source,
                "{fixture_name} should be canonical"
            );
        }
    }

    #[test]
    fn missing_request_id_is_rejected() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"request","method":"host.ping","timestamp":1710000000000,"traceId":"trace-missing"}"#,
        )
        .expect_err("request id is required");

        assert!(
            error.to_string().contains("missing field `id`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn stream_requires_request_or_resource_target() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"stream","timestamp":1710000000000,"traceId":"trace-missing"}"#,
        )
        .expect_err("stream target is required");

        assert_eq!(
            error.to_string(),
            "stream envelope requires id or resourceId"
        );
    }

    #[test]
    fn cancel_requires_request_or_resource_target() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"cancel","timestamp":1710000000000,"traceId":"trace-missing"}"#,
        )
        .expect_err("cancel target is required");

        assert_eq!(
            error.to_string(),
            "cancel envelope requires id or resourceId"
        );
    }

    #[test]
    fn envelope_excess_fields_are_rejected() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":"trace-1","error":{"tag":"Internal","message":"extra"}}"#,
        )
        .expect_err("unknown envelope fields must fail");

        assert!(
            error.to_string().contains("unknown field `error`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn host_protocol_error_excess_fields_are_rejected() {
        let error = serde_json::from_str::<HostProtocolError>(
            r#"{"tag":"FileNotFound","path":"/tmp/missing.txt","message":"FileNotFound sample","operation":"fixture.operation","recoverable":false,"unexpected":true}"#,
        )
        .expect_err("unknown error fields must fail");

        assert!(
            error.to_string().contains("unknown field `unexpected`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn host_protocol_error_platform_is_closed() {
        let error = serde_json::from_str::<HostProtocolError>(
            r#"{"tag":"FileNotFound","path":"/tmp/missing.txt","message":"FileNotFound sample","operation":"fixture.operation","platform":"solaris","recoverable":false}"#,
        )
        .expect_err("unknown platforms must fail");

        assert!(
            error.to_string().contains("unknown variant `solaris`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn host_protocol_error_recoverable_defaults_come_from_specs() {
        for spec in HOST_PROTOCOL_ERROR_SPECS {
            assert_eq!(
                HostProtocolError::recoverable_default(spec.tag),
                Some(spec.recoverable),
                "{} recoverable default should come from the spec manifest",
                spec.tag
            );
        }
    }

    #[test]
    fn host_protocol_error_fixtures_match_closed_registry() {
        let source = read_fixture("errors.json");
        let errors =
            serde_json::from_str::<Vec<HostProtocolError>>(&source).expect("errors should decode");

        assert_eq!(
            serde_json::to_string(&errors).expect("errors should encode"),
            source,
            "errors.json should be canonical"
        );

        let fixture_tags = errors
            .iter()
            .map(HostProtocolError::tag)
            .collect::<Vec<_>>();
        let spec_tags = HOST_PROTOCOL_ERROR_SPECS
            .iter()
            .map(|spec| spec.tag)
            .collect::<Vec<_>>();

        assert_eq!(fixture_tags, spec_tags);
        assert_eq!(
            fixture_tags.iter().copied().collect::<BTreeSet<_>>().len(),
            fixture_tags.len(),
            "error fixtures should not contain duplicate tags"
        );

        for error in errors {
            assert_eq!(
                error.recoverable(),
                HostProtocolError::recoverable_default(error.tag()).expect("fixture tag is known"),
                "{} recoverable field should match registry default",
                error.tag()
            );
        }
    }

    #[test]
    fn stream_requires_request_or_resource_target_before_serializing() {
        let envelope = HostProtocolEnvelope::Stream {
            id: None,
            resource_id: None,
            timestamp: 1710000000000,
            trace_id: "trace-missing".to_string(),
            payload: None,
            error: None,
        };

        let error = serde_json::to_string(&envelope).expect_err("stream target is required");

        assert_eq!(
            error.to_string(),
            "stream envelope requires id or resourceId"
        );
    }

    #[test]
    fn cancel_requires_request_or_resource_target_before_serializing() {
        let envelope = HostProtocolEnvelope::Cancel {
            id: None,
            resource_id: None,
            timestamp: 1710000000000,
            trace_id: "trace-missing".to_string(),
        };

        let error = serde_json::to_string(&envelope).expect_err("cancel target is required");

        assert_eq!(
            error.to_string(),
            "cancel envelope requires id or resourceId"
        );
    }

    #[test]
    fn host_protocol_error_tags_are_closed() {
        let error = serde_json::from_str::<HostProtocolError>(
            r#"{"tag":"NotARealError","message":"not real"}"#,
        )
        .expect_err("unknown tags must fail");

        assert!(
            error
                .to_string()
                .contains("unknown variant `NotARealError`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn host_version_payload_serializes_canonically() {
        let payload = HostVersionPayload::current();

        assert_eq!(payload.protocol_version(), PROTOCOL_VERSION);
        assert_eq!(
            serde_json::to_string(&payload).expect("version payload should encode"),
            format!(r#"{{"protocolVersion":"{PROTOCOL_VERSION}"}}"#)
        );
    }

    #[test]
    fn window_create_payload_accepts_macos_polish_fields() {
        let payload = serde_json::from_str::<WindowCreatePayload>(
            r#"{"title":"Polished","width":320,"height":240,"titleBarStyle":"hiddenInset","vibrancy":"windowBackground","trafficLights":{"x":12,"y":13}}"#,
        )
        .expect("macOS window polish payload should decode");

        assert_eq!(payload.title(), Some("Polished"));
        assert_eq!(
            payload.title_bar_style(),
            Some(WindowTitleBarStyle::HiddenInset)
        );
        assert_eq!(payload.vibrancy(), Some("windowBackground"));
        assert_eq!(
            payload.traffic_lights(),
            Some(&WindowTrafficLights::new(12.0, 13.0))
        );
    }

    #[test]
    fn window_create_payload_rejects_unknown_fields() {
        let error = serde_json::from_str::<WindowCreatePayload>(
            r#"{"width":320,"height":240,"unknown":true}"#,
        )
        .expect_err("unknown window create fields must fail");

        assert!(
            error.to_string().contains("unknown field `unknown`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn window_create_response_serializes_canonically() {
        let payload = WindowCreateResponse::new("window-1");

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(
            serde_json::to_string(&payload).expect("window create response should encode"),
            r#"{"windowId":"window-1"}"#
        );
    }

    #[test]
    fn window_destroy_payload_serializes_canonically() {
        let payload = WindowDestroyPayload::new("window-1");

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(
            serde_json::to_string(&payload).expect("window destroy payload should encode"),
            r#"{"windowId":"window-1"}"#
        );
    }

    #[test]
    fn reconnect_defaults_match_spec_values() {
        assert_eq!(DEFAULT_RECONNECT_WINDOW_MS, 30_000);
        assert_eq!(DEFAULT_MAX_BACKFILL_EVENTS, 1_024);
    }

    #[test]
    fn resume_ticket_serializes_canonically() {
        let ticket = ResumeTicket::new(
            "window-1",
            "sha256:origin",
            "resume-1",
            1710000030000,
            BTreeMap::from([("stream-1".to_string(), "42".to_string())]),
        );

        assert_eq!(ticket.window_id(), "window-1");
        assert_eq!(ticket.origin_token_hash(), "sha256:origin");
        assert_eq!(ticket.resume_nonce(), "resume-1");
        assert_eq!(ticket.expires_at(), 1710000030000);
        assert_eq!(
            ticket.last_stream_cursors().get("stream-1"),
            Some(&"42".to_string())
        );
        assert_eq!(
            serde_json::to_string(&ticket).expect("resume ticket should encode"),
            r#"{"windowId":"window-1","originTokenHash":"sha256:origin","resumeNonce":"resume-1","expiresAt":1710000030000,"lastStreamCursors":{"stream-1":"42"}}"#
        );
    }

    #[test]
    fn renderer_resume_payload_serializes_canonically() {
        let payload = RendererResumePayload::new(
            "window-1",
            "resume-1",
            BTreeMap::from([("stream-1".to_string(), "42".to_string())]),
        );

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(payload.resume_nonce(), "resume-1");
        assert_eq!(payload.cursors().get("stream-1"), Some(&"42".to_string()));
        assert_eq!(
            serde_json::to_string(&payload).expect("renderer resume payload should encode"),
            r#"{"windowId":"window-1","resumeNonce":"resume-1","cursors":{"stream-1":"42"}}"#
        );
    }

    #[test]
    fn renderer_resumed_payload_serializes_canonically() {
        let payload = RendererResumedPayload::new("window-1", vec!["stream-1".to_string()]);

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(payload.replayed_stream_ids(), ["stream-1".to_string()]);
        assert_eq!(
            serde_json::to_string(&payload).expect("renderer resumed payload should encode"),
            r#"{"windowId":"window-1","replayedStreamIds":["stream-1"]}"#
        );
    }

    #[test]
    fn renderer_resume_denied_payload_serializes_canonically() {
        let payload = RendererResumeDeniedPayload::new(
            "window-1",
            RendererResumeDeniedReason::BackfillExhausted,
            "reconnect backfill exhausted",
        );

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(
            payload.reason(),
            &RendererResumeDeniedReason::BackfillExhausted
        );
        assert_eq!(payload.message(), "reconnect backfill exhausted");
        assert_eq!(
            serde_json::to_string(&payload).expect("renderer resume denied payload should encode"),
            r#"{"windowId":"window-1","reason":"backfillExhausted","message":"reconnect backfill exhausted"}"#
        );
    }

    fn read_fixture(name: &str) -> String {
        fs::read_to_string(fixture_path(name))
            .unwrap_or_else(|error| panic!("failed to read fixture {name}: {error}"))
            .trim()
            .to_string()
    }

    fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(name)
    }
}

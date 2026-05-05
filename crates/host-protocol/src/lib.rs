//! Host-runtime protocol wire types.

mod error;

pub use error::{
    HostProtocolError, HostProtocolErrorSpec, HostProtocolPlatform, HOST_PROTOCOL_ERROR_SPECS,
};

use serde::{de, ser, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

pub const HOST_PING_METHOD: &str = "host.ping";
pub const HOST_VERSION_METHOD: &str = "host.version";
pub const PROTOCOL_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const WINDOW_CREATE_METHOD: &str = "Window.create";
pub const WINDOW_DESTROY_METHOD: &str = "Window.destroy";

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
}

impl WindowCreatePayload {
    pub fn new(title: Option<String>, width: Option<f64>, height: Option<f64>) -> Self {
        Self {
            title,
            width,
            height,
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
        HostProtocolEnvelope, HostProtocolError, HostVersionPayload, WindowCreatePayload,
        WindowCreateResponse, WindowDestroyPayload, HOST_PROTOCOL_ERROR_SPECS, PROTOCOL_VERSION,
    };
    use std::{collections::BTreeSet, fs, path::PathBuf};

    const FIXTURE_NAMES: &[&str] = &[
        "request.json",
        "response.json",
        "event.json",
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

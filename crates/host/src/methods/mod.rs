pub(crate) mod handshake;

use host_protocol::{HostProtocolEnvelope, HostProtocolError};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn dispatch(envelope: HostProtocolEnvelope) -> Option<HostProtocolEnvelope> {
    dispatch_at(envelope, timestamp_millis())
}

fn dispatch_at(envelope: HostProtocolEnvelope, timestamp: u64) -> Option<HostProtocolEnvelope> {
    let HostProtocolEnvelope::Request {
        id,
        method,
        trace_id,
        ..
    } = envelope
    else {
        return None;
    };

    let (payload, error) = match method.as_str() {
        host_protocol::HOST_PING_METHOD => (None, None),
        host_protocol::HOST_VERSION_METHOD => (Some(handshake::version_payload()), None),
        _ => (
            None,
            Some(HostProtocolError::MethodNotFound {
                method: method.clone(),
            }),
        ),
    };

    Some(HostProtocolEnvelope::Response {
        id,
        timestamp,
        trace_id,
        payload,
        error,
    })
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
    use super::dispatch_at;
    use host_protocol::{HostProtocolEnvelope, HostProtocolError, PROTOCOL_VERSION};

    #[test]
    fn ping_returns_response_with_matching_id_and_trace() {
        let response = dispatch_at(request("request-ping", "host.ping"), 1710000000100)
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
        let response = dispatch_at(request("request-version", "host.version"), 1710000000101)
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
        let response = dispatch_at(request("request-missing", "host.missing"), 1710000000102)
            .expect("unknown request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-missing".to_string(),
                timestamp: 1710000000102,
                trace_id: "trace-request-missing".to_string(),
                payload: None,
                error: Some(HostProtocolError::MethodNotFound {
                    method: "host.missing".to_string(),
                }),
            }
        );
    }

    #[test]
    fn non_request_envelopes_do_not_dispatch() {
        let response = dispatch_at(
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

    fn request(id: &str, method: &str) -> HostProtocolEnvelope {
        HostProtocolEnvelope::Request {
            id: id.to_string(),
            method: method.to_string(),
            timestamp: 1710000000000,
            trace_id: format!("trace-{id}"),
            window_id: None,
            origin_token: None,
            payload: None,
        }
    }
}

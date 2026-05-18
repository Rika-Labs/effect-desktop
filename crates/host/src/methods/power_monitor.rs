#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, PowerMonitorIsSupportedPayload, PowerMonitorSupportedPayload,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{to_value, Value};

pub(crate) fn is_supported(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let _input = decode_payload::<PowerMonitorIsSupportedPayload>(
        payload,
        host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
    )?;
    encode_payload(
        PowerMonitorSupportedPayload::unsupported(),
        host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
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
            format!("failed to encode power monitor payload: {error}"),
            operation,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::is_supported;
    use serde_json::json;

    #[test]
    fn power_monitor_support_reports_false_for_known_methods() {
        let payload = is_supported(Some(json!({ "method": "onSuspend" })))
            .expect("support query should return payload");
        assert_eq!(payload, Some(json!({ "supported": false })));
    }

    #[test]
    fn power_monitor_support_rejects_unknown_methods() {
        let error = is_supported(Some(json!({ "method": "onLockScreen" })))
            .expect_err("unknown method should reject");
        assert_eq!(
            error,
            host_protocol::HostProtocolError::invalid_argument(
                "payload",
                "unknown variant `onLockScreen`, expected one of `onSuspend`, `onResume`, `onShutdown`, `onPowerSourceChanged`",
                host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
            )
        );
    }
}

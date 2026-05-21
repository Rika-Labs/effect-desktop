#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::{HostProtocolError, NetworkAuthSetProxyPayload, NetworkAuthSupportedPayload};
use serde::de::DeserializeOwned;
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-network-auth-unavailable";

pub(crate) fn set_proxy(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_payload::<NetworkAuthSetProxyPayload>(
        payload,
        host_protocol::NETWORK_AUTH_SET_PROXY_METHOD,
    )?;
    let result = handler.set_network_auth_proxy(payload)?;
    encode_payload(result, host_protocol::NETWORK_AUTH_SET_PROXY_METHOD)
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(NetworkAuthSupportedPayload::unsupported(UNSUPPORTED_REASON))
        .map(Some)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode network auth support: {error}"),
                host_protocol::NETWORK_AUTH_IS_SUPPORTED_METHOD,
            )
        })
}

fn decode_payload<T: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    let Some(payload) = payload else {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "must be an object",
            operation,
        ));
    };
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            format!("invalid payload: {error}"),
            operation,
        )
    })
}

fn encode_payload<T: serde::Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode network auth payload: {error}"),
            operation,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::is_supported;
    use serde_json::json;

    #[test]
    fn network_auth_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-network-auth-unavailable"
            })
        );
    }
}

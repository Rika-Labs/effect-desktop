#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, NativeNetworkSupportedPayload};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-native-network-unavailable";

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(NativeNetworkSupportedPayload::unsupported(
        UNSUPPORTED_REASON,
    ))
    .map(Some)
    .map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode native network support: {error}"),
            host_protocol::NATIVE_NETWORK_IS_SUPPORTED_METHOD,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::is_supported;
    use serde_json::json;

    #[test]
    fn native_network_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-native-network-unavailable"
            })
        );
    }
}

#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, WebRequestSupportedPayload};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-web-request-unavailable";

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(WebRequestSupportedPayload::unsupported(UNSUPPORTED_REASON))
        .map(Some)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode web request support: {error}"),
                host_protocol::WEB_REQUEST_IS_SUPPORTED_METHOD,
            )
        })
}

#[cfg(test)]
mod tests {
    use super::is_supported;
    use serde_json::json;

    #[test]
    fn web_request_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-web-request-unavailable"
            })
        );
    }
}

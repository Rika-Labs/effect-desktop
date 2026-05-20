#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, ScopedAccessGrantSupportedPayload};
use serde::Serialize;
use serde_json::{to_value, Value};

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ScopedAccessGrantSupportedPayload::unsupported(
            host_protocol::SCOPED_ACCESS_GRANT_UNSUPPORTED_REASON,
        ),
        host_protocol::SCOPED_ACCESS_GRANT_IS_SUPPORTED_METHOD,
    )
}

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode scoped access grant payload: {error}"),
            operation,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn is_supported_reports_unimplemented_adapter() {
        let payload = is_supported()
            .expect("support query should encode")
            .expect("support query returns payload");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::SCOPED_ACCESS_GRANT_UNSUPPORTED_REASON
            })
        );
    }
}

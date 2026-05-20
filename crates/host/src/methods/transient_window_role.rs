#![allow(clippy::result_large_err)]

use host_protocol::{HostProtocolError, TransientWindowRoleSupportedPayload};
use serde::Serialize;
use serde_json::{to_value, Value};

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        TransientWindowRoleSupportedPayload::unsupported(
            host_protocol::TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON,
        ),
        host_protocol::TRANSIENT_WINDOW_ROLE_IS_SUPPORTED_METHOD,
    )
}

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode transient window role payload: {error}"),
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
            .expect("support response should encode")
            .expect("support response should include payload");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON
            })
        );
    }
}

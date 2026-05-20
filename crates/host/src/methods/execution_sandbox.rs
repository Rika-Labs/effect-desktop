#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{ExecutionSandboxSupportedPayload, HostProtocolError};
use serde::Serialize;
use serde_json::{to_value, Value};

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ExecutionSandboxSupportedPayload::unsupported(
            host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON,
        ),
        host_protocol::EXECUTION_SANDBOX_IS_SUPPORTED_METHOD,
    )
}

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode execution sandbox payload: {error}"),
            operation,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::is_supported;
    use serde_json::json;

    #[test]
    fn is_supported_returns_false_with_reason() {
        let response = is_supported().expect("support query should encode");

        assert_eq!(
            response,
            Some(json!({
                "supported": false,
                "reason": "host-adapter-unimplemented"
            }))
        );
    }
}

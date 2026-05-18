#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::HostProtocolError;
use serde_json::Value;

pub(crate) fn get_info(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::APP_METADATA_GET_INFO_METHOD)?;
    Err(unsupported(host_protocol::APP_METADATA_GET_INFO_METHOD))
}

pub(crate) fn get_paths(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::APP_METADATA_GET_PATHS_METHOD)?;
    Err(unsupported(host_protocol::APP_METADATA_GET_PATHS_METHOD))
}

pub(crate) fn get_launch_context(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(
        payload,
        host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD,
    )?;
    Err(unsupported(
        host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD,
    ))
}

fn reject_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        )),
    }
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::APP_METADATA_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{get_info, get_launch_context, get_paths};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn app_metadata_requests_reject_payloads_before_unsupported() {
        assert_eq!(
            get_info(Some(json!({}))).expect_err("get info rejects object payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_METADATA_GET_INFO_METHOD,
            )
        );
        assert_eq!(
            get_paths(Some(json!({ "unexpected": true })))
                .expect_err("get paths rejects object payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_METADATA_GET_PATHS_METHOD,
            )
        );
        assert_eq!(
            get_launch_context(Some(json!([]))).expect_err("launch context rejects array payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD,
            )
        );
    }

    #[test]
    fn app_metadata_requests_return_typed_unsupported() {
        assert_eq!(
            get_info(None).expect_err("get info unsupported"),
            HostProtocolError::unsupported(
                host_protocol::APP_METADATA_UNSUPPORTED_REASON,
                host_protocol::APP_METADATA_GET_INFO_METHOD,
            )
        );
        assert_eq!(
            get_paths(Some(json!(null))).expect_err("get paths unsupported"),
            HostProtocolError::unsupported(
                host_protocol::APP_METADATA_UNSUPPORTED_REASON,
                host_protocol::APP_METADATA_GET_PATHS_METHOD,
            )
        );
        assert_eq!(
            get_launch_context(None).expect_err("launch context unsupported"),
            HostProtocolError::unsupported(
                host_protocol::APP_METADATA_UNSUPPORTED_REASON,
                host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD,
            )
        );
    }
}

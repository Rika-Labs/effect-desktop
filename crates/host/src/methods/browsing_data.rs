#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::{
    BrowsingDataClearPayload, BrowsingDataListTypesPayload, BrowsingDataSupportedPayload,
    BrowsingDataTypePayload, HostProtocolError,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) fn clear(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_payload::<BrowsingDataClearPayload>(
        payload,
        host_protocol::BROWSING_DATA_CLEAR_METHOD,
    )?;
    if payload.types().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "types",
            "must not be empty",
            host_protocol::BROWSING_DATA_CLEAR_METHOD,
        ));
    }
    serde_json::to_value(handler.clear_browsing_data(payload)?)
        .map(Some)
        .map_err(|error| encode_error(error, host_protocol::BROWSING_DATA_CLEAR_METHOD))
}

pub(crate) fn list_types(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    if payload.is_some() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "must be absent",
            host_protocol::BROWSING_DATA_LIST_TYPES_METHOD,
        ));
    }

    serde_json::to_value(BrowsingDataListTypesPayload::new(
        portable_browsing_data_types(),
    ))
    .map(Some)
    .map_err(|error| encode_error(error, host_protocol::BROWSING_DATA_LIST_TYPES_METHOD))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(BrowsingDataSupportedPayload::supported())
        .map(Some)
        .map_err(|error| encode_error(error, host_protocol::BROWSING_DATA_IS_SUPPORTED_METHOD))
}

fn portable_browsing_data_types() -> Vec<BrowsingDataTypePayload> {
    vec![
        BrowsingDataTypePayload::Cache,
        BrowsingDataTypePayload::Cookies,
        BrowsingDataTypePayload::LocalStorage,
        BrowsingDataTypePayload::IndexedDb,
        BrowsingDataTypePayload::History,
        BrowsingDataTypePayload::ServiceWorkers,
    ]
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

fn encode_error(error: serde_json::Error, operation: &'static str) -> HostProtocolError {
    HostProtocolError::internal(
        format!("failed to encode browsing data response: {error}"),
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{clear, is_supported, list_types};
    use crate::window::WindowMethodPort;
    use serde_json::json;

    #[test]
    fn browsing_data_support_reports_available_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(response, json!({ "supported": true }));
    }

    #[test]
    fn browsing_data_clear_rejects_empty_types() {
        let handler = WindowMethodPort::new();
        let error = clear(
            &handler,
            Some(json!({
                "profile": {
                    "kind": "session-profile",
                    "id": "session-profile:workspace-1",
                    "generation": 0,
                    "ownerScope": "workspace:1",
                    "state": "open"
                },
                "types": []
            })),
        )
        .expect_err("empty types should be rejected");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn browsing_data_list_types_reports_portable_type_set() {
        let response = list_types(None)
            .expect("list types should encode")
            .expect("list types should return a payload");

        assert_eq!(
            response,
            json!({
                "types": [
                    "cache",
                    "cookies",
                    "localStorage",
                    "indexedDb",
                    "history",
                    "serviceWorkers"
                ]
            })
        );
    }

    #[test]
    fn browsing_data_list_types_rejects_payload() {
        let error =
            list_types(Some(json!({}))).expect_err("listTypes should reject unexpected payloads");

        assert_eq!(error.tag(), "InvalidArgument");
    }
}

#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::{CookieStoreGetPayload, CookieStoreSupportedPayload, HostProtocolError};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) fn get(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload =
        decode_payload::<CookieStoreGetPayload>(payload, host_protocol::COOKIE_STORE_GET_METHOD)?;
    if payload.url().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "url",
            "must be non-empty",
            host_protocol::COOKIE_STORE_GET_METHOD,
        ));
    }
    if let Some(name) = payload.name() {
        if name.is_empty() {
            return Err(HostProtocolError::invalid_argument(
                "name",
                "must be non-empty when present",
                host_protocol::COOKIE_STORE_GET_METHOD,
            ));
        }
    }

    serde_json::to_value(handler.get_cookies(payload)?)
        .map(Some)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode cookie store get response: {error}"),
                host_protocol::COOKIE_STORE_GET_METHOD,
            )
        })
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(CookieStoreSupportedPayload::supported())
        .map(Some)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode cookie store support: {error}"),
                host_protocol::COOKIE_STORE_IS_SUPPORTED_METHOD,
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

#[cfg(test)]
mod tests {
    use super::{get, is_supported};
    use crate::window::WindowMethodPort;
    use serde_json::json;

    #[test]
    fn cookie_store_support_reports_available_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(response, json!({ "supported": true }));
    }

    #[test]
    fn cookie_store_get_rejects_invalid_payload_before_window_dispatch() {
        let handler = WindowMethodPort::new();
        let error =
            get(&handler, Some(json!({ "url": "" }))).expect_err("payload should be rejected");

        assert_eq!(error.tag(), "InvalidArgument");
    }
}

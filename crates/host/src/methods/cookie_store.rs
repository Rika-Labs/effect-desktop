#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::WindowMethodHandler;
use host_protocol::{
    CookieStoreCookiePayload, CookieStoreGetPayload, CookieStoreRemovePayload,
    CookieStoreSetPayload, CookieStoreSupportedPayload, HostProtocolError,
};
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

pub(crate) fn remove(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_payload::<CookieStoreRemovePayload>(
        payload,
        host_protocol::COOKIE_STORE_REMOVE_METHOD,
    )?;
    if payload.url().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "url",
            "must be non-empty",
            host_protocol::COOKIE_STORE_REMOVE_METHOD,
        ));
    }
    if payload.name().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "name",
            "must be non-empty",
            host_protocol::COOKIE_STORE_REMOVE_METHOD,
        ));
    }

    handler.remove_cookie(payload)?;
    Ok(None)
}

pub(crate) fn set(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload =
        decode_payload::<CookieStoreSetPayload>(payload, host_protocol::COOKIE_STORE_SET_METHOD)?;
    if payload.url().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "url",
            "must be non-empty",
            host_protocol::COOKIE_STORE_SET_METHOD,
        ));
    }
    validate_cookie(payload.cookie(), host_protocol::COOKIE_STORE_SET_METHOD)?;

    handler.set_cookie(payload)?;
    Ok(None)
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

fn validate_cookie(
    cookie: &CookieStoreCookiePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if cookie.name().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "cookie.name",
            "must be non-empty",
            operation,
        ));
    }
    if cookie.domain().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "cookie.domain",
            "must be non-empty",
            operation,
        ));
    }
    if !cookie.path().starts_with('/') {
        return Err(HostProtocolError::invalid_argument(
            "cookie.path",
            "must start with /",
            operation,
        ));
    }
    if let Some(expires_at) = cookie.expires_at() {
        if !expires_at.is_finite() {
            return Err(HostProtocolError::invalid_argument(
                "cookie.expiresAt",
                "must be finite",
                operation,
            ));
        }
    }
    Ok(())
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
    use super::{get, is_supported, remove, set};
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

    #[test]
    fn cookie_store_remove_rejects_invalid_payload_before_window_dispatch() {
        let handler = WindowMethodPort::new();
        let error = remove(
            &handler,
            Some(json!({
                "profile": {
                    "kind": "session-profile",
                    "id": "session-profile:workspace-1",
                    "generation": 0,
                    "ownerScope": "workspace:1",
                    "state": "open"
                },
                "url": "https://example.test/account",
                "name": ""
            })),
        )
        .expect_err("payload should be rejected");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn cookie_store_set_rejects_invalid_payload_before_window_dispatch() {
        let handler = WindowMethodPort::new();
        let error = set(
            &handler,
            Some(json!({
                "profile": {
                    "kind": "session-profile",
                    "id": "session-profile:workspace-1",
                    "generation": 0,
                    "ownerScope": "workspace:1",
                    "state": "open"
                },
                "url": "https://example.test/account",
                "cookie": {
                    "name": "token",
                    "value": "secret",
                    "domain": "example.test",
                    "path": "account"
                }
            })),
        )
        .expect_err("payload should be rejected");

        assert_eq!(error.tag(), "InvalidArgument");
    }
}

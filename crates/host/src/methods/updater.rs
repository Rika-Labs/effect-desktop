#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, UpdaterCheckPayload, UpdaterDownloadPayload, UpdaterInstallPayload,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) fn check(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<UpdaterCheckPayload>(payload, host_protocol::UPDATER_CHECK_METHOD)?;
    validate_optional_version(
        "currentVersion",
        input.current_version(),
        host_protocol::UPDATER_CHECK_METHOD,
    )?;
    Err(unsupported(host_protocol::UPDATER_CHECK_METHOD))
}

pub(crate) fn download(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<UpdaterDownloadPayload>(payload, host_protocol::UPDATER_DOWNLOAD_METHOD)?;
    validate_optional_version(
        "version",
        input.version(),
        host_protocol::UPDATER_DOWNLOAD_METHOD,
    )?;
    Err(unsupported(host_protocol::UPDATER_DOWNLOAD_METHOD))
}

pub(crate) fn install(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<UpdaterInstallPayload>(payload, host_protocol::UPDATER_INSTALL_METHOD)?;
    validate_optional_version(
        "version",
        input.version(),
        host_protocol::UPDATER_INSTALL_METHOD,
    )?;
    Err(unsupported(host_protocol::UPDATER_INSTALL_METHOD))
}

pub(crate) fn install_and_restart(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<UpdaterInstallPayload>(
        payload,
        host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
    )?;
    validate_optional_version(
        "version",
        input.version(),
        host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
    )?;
    Err(unsupported(
        host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
    ))
}

pub(crate) fn get_status(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::UPDATER_GET_STATUS_METHOD)?;
    Err(unsupported(host_protocol::UPDATER_GET_STATUS_METHOD))
}

pub(crate) fn ready_for_restart(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::UPDATER_READY_FOR_RESTART_METHOD)?;
    Err(unsupported(host_protocol::UPDATER_READY_FOR_RESTART_METHOD))
}

fn decode_payload<T: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    let payload = payload
        .ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))?;
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn reject_unexpected_payload(
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

fn validate_optional_version(
    field: &'static str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::UPDATER_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{check, download, get_status, install, install_and_restart, ready_for_restart};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn updater_requests_decode_before_unsupported() {
        assert_eq!(
            check(Some(json!({ "currentVersion": "1.0.0" }))).expect_err("check"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_CHECK_METHOD,
            )
        );
        assert_eq!(
            download(Some(json!({ "version": "1.1.0" }))).expect_err("download"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
        );
        assert_eq!(
            install(Some(json!({ "version": "1.1.0" }))).expect_err("install"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_INSTALL_METHOD,
            )
        );
        assert_eq!(
            install_and_restart(Some(json!({ "version": "1.1.0" })))
                .expect_err("install and restart"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
            )
        );
        assert_eq!(
            get_status(None).expect_err("get status"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_GET_STATUS_METHOD,
            )
        );
        assert_eq!(
            ready_for_restart(None).expect_err("ready for restart"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_READY_FOR_RESTART_METHOD,
            )
        );
    }

    #[test]
    fn updater_rejects_malformed_payloads_before_unsupported() {
        assert_eq!(
            check(Some(json!({ "currentVersion": "bad\nversion" }))).expect_err("version"),
            HostProtocolError::invalid_argument(
                "currentVersion",
                "must not include control characters",
                host_protocol::UPDATER_CHECK_METHOD,
            )
        );
        assert_eq!(
            install(Some(json!({ "version": "" }))).expect_err("version"),
            HostProtocolError::invalid_argument(
                "version",
                "must be non-empty",
                host_protocol::UPDATER_INSTALL_METHOD,
            )
        );
        assert_eq!(
            get_status(Some(json!({}))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::UPDATER_GET_STATUS_METHOD,
            )
        );
    }
}

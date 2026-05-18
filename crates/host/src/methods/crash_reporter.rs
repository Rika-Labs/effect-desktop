#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{CrashReporterBreadcrumbPayload, CrashReporterStartPayload, HostProtocolError};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) fn start(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(
        payload.as_ref(),
        "enabled",
        host_protocol::CRASH_REPORTER_START_METHOD,
    )?;
    let _input = decode_payload::<CrashReporterStartPayload>(
        payload,
        host_protocol::CRASH_REPORTER_START_METHOD,
    )?;
    Err(unsupported(host_protocol::CRASH_REPORTER_START_METHOD))
}

pub(crate) fn record_breadcrumb(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(
        payload.as_ref(),
        "timestamp",
        host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
    )?;
    let input = decode_payload::<CrashReporterBreadcrumbPayload>(
        payload,
        host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
    )?;
    validate_category(
        input.category(),
        host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
    )?;
    Err(unsupported(
        host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
    ))
}

pub(crate) fn flush(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CRASH_REPORTER_FLUSH_METHOD)?;
    Err(unsupported(host_protocol::CRASH_REPORTER_FLUSH_METHOD))
}

pub(crate) fn get_reports(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD)?;
    Err(unsupported(
        host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD,
    ))
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

fn reject_null_field(
    payload: Option<&Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if matches!(
        payload
            .and_then(Value::as_object)
            .and_then(|object| object.get(field)),
        Some(Value::Null)
    ) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be omitted instead of null",
            operation,
        ));
    }
    Ok(())
}

fn validate_category(category: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if category.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "category",
            "must be non-empty",
            operation,
        ));
    }
    if category.chars().any(is_ascii_control_or_del) {
        return Err(HostProtocolError::invalid_argument(
            "category",
            "must not include ASCII control characters",
            operation,
        ));
    }
    Ok(())
}

fn is_ascii_control_or_del(character: char) -> bool {
    matches!(character, '\u{0000}'..='\u{001f}' | '\u{007f}')
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::CRASH_REPORTER_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{flush, get_reports, record_breadcrumb, start};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn crash_reporter_requests_decode_before_unsupported() {
        assert_eq!(
            start(Some(json!({ "enabled": true }))).expect_err("start"),
            HostProtocolError::unsupported(
                host_protocol::CRASH_REPORTER_UNSUPPORTED_REASON,
                host_protocol::CRASH_REPORTER_START_METHOD,
            )
        );
        assert_eq!(
            record_breadcrumb(Some(json!({
                "category": "startup",
                "message": "renderer ready",
                "details": { "windowId": "window-1" },
                "timestamp": 1710000000000.0
            })))
            .expect_err("breadcrumb"),
            HostProtocolError::unsupported(
                host_protocol::CRASH_REPORTER_UNSUPPORTED_REASON,
                host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
            )
        );
        assert_eq!(
            flush(None).expect_err("flush"),
            HostProtocolError::unsupported(
                host_protocol::CRASH_REPORTER_UNSUPPORTED_REASON,
                host_protocol::CRASH_REPORTER_FLUSH_METHOD,
            )
        );
        assert_eq!(
            get_reports(None).expect_err("get reports"),
            HostProtocolError::unsupported(
                host_protocol::CRASH_REPORTER_UNSUPPORTED_REASON,
                host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD,
            )
        );
    }

    #[test]
    fn crash_reporter_rejects_malformed_payloads_before_unsupported() {
        assert_eq!(
            record_breadcrumb(Some(
                json!({ "category": "bad\ncategory", "message": "bad" })
            ))
            .expect_err("category"),
            HostProtocolError::invalid_argument(
                "category",
                "must not include ASCII control characters",
                host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
            )
        );
        assert_eq!(
            flush(Some(json!({}))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::CRASH_REPORTER_FLUSH_METHOD,
            )
        );
        assert_eq!(
            get_reports(Some(json!({}))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD,
            )
        );
    }

    #[test]
    fn crash_reporter_matches_typescript_optional_and_category_shape() {
        assert_eq!(
            start(Some(json!({ "enabled": null }))).expect_err("enabled"),
            HostProtocolError::invalid_argument(
                "enabled",
                "must be omitted instead of null",
                host_protocol::CRASH_REPORTER_START_METHOD,
            )
        );
        assert_eq!(
            record_breadcrumb(Some(json!({
                "category": "startup",
                "message": "renderer ready",
                "timestamp": null
            })))
            .expect_err("timestamp"),
            HostProtocolError::invalid_argument(
                "timestamp",
                "must be omitted instead of null",
                host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
            )
        );
        assert_eq!(
            record_breadcrumb(Some(
                json!({ "category": "ok\u{0080}", "message": "valid" })
            ))
            .expect_err("breadcrumb"),
            HostProtocolError::unsupported(
                host_protocol::CRASH_REPORTER_UNSUPPORTED_REASON,
                host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
            )
        );
    }
}

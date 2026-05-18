#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    ClipboardHtmlPayload, ClipboardImagePayload, ClipboardIsSupportedPayload,
    ClipboardSupportedPayload, ClipboardTextPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

const PNG_HEADER: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER: &[u8] = &[0xff, 0xd8, 0xff];

pub(crate) fn read_text(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CLIPBOARD_READ_TEXT_METHOD)?;
    Err(unsupported(host_protocol::CLIPBOARD_READ_TEXT_METHOD))
}

pub(crate) fn write_text(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ClipboardTextPayload>(
        payload,
        host_protocol::CLIPBOARD_WRITE_TEXT_METHOD,
    )?;
    validate_text(
        input.text(),
        "text",
        host_protocol::CLIPBOARD_WRITE_TEXT_METHOD,
    )?;
    Err(unsupported(host_protocol::CLIPBOARD_WRITE_TEXT_METHOD))
}

pub(crate) fn read_html(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CLIPBOARD_READ_HTML_METHOD)?;
    Err(unsupported(host_protocol::CLIPBOARD_READ_HTML_METHOD))
}

pub(crate) fn write_html(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ClipboardHtmlPayload>(
        payload,
        host_protocol::CLIPBOARD_WRITE_HTML_METHOD,
    )?;
    validate_text(
        input.html(),
        "html",
        host_protocol::CLIPBOARD_WRITE_HTML_METHOD,
    )?;
    Err(unsupported(host_protocol::CLIPBOARD_WRITE_HTML_METHOD))
}

pub(crate) fn read_image(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CLIPBOARD_READ_IMAGE_METHOD)?;
    Err(unsupported(host_protocol::CLIPBOARD_READ_IMAGE_METHOD))
}

pub(crate) fn write_image(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ClipboardImagePayload>(
        payload,
        host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD,
    )?;
    validate_image(&input, host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD)?;
    Err(unsupported(host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD))
}

pub(crate) fn clear(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CLIPBOARD_CLEAR_METHOD)?;
    Err(unsupported(host_protocol::CLIPBOARD_CLEAR_METHOD))
}

pub(crate) fn is_supported(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let _input = decode_payload::<ClipboardIsSupportedPayload>(
        payload,
        host_protocol::CLIPBOARD_IS_SUPPORTED_METHOD,
    )?;
    encode_payload(
        ClipboardSupportedPayload::unsupported(host_protocol::CLIPBOARD_UNSUPPORTED_REASON),
        host_protocol::CLIPBOARD_IS_SUPPORTED_METHOD,
    )
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

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode clipboard payload: {error}"),
            operation,
        )
    })
}

fn validate_text(
    value: &str,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.bytes().any(|byte| byte == 0) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL bytes",
            operation,
        ));
    }
    Ok(())
}

fn validate_image(
    image: &ClipboardImagePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let expected = match image.mime() {
        "image/png" => PNG_HEADER,
        "image/jpeg" => JPEG_HEADER,
        _ => {
            return Err(HostProtocolError::invalid_argument(
                "mime",
                "must be image/png or image/jpeg",
                operation,
            ));
        }
    };
    if !image.bytes().starts_with(expected) {
        return Err(HostProtocolError::invalid_argument(
            "bytes",
            "must match declared image MIME header",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::CLIPBOARD_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{clear, is_supported, read_text, write_html, write_image, write_text};
    use host_protocol::{ClipboardCapabilityPayload, ClipboardSupportedPayload, HostProtocolError};
    use serde_json::json;

    #[test]
    fn write_text_rejects_nul_before_unsupported() {
        assert_eq!(
            write_text(Some(json!({ "text": "bad\u{0000}text" }))).expect_err("text"),
            HostProtocolError::invalid_argument(
                "text",
                "must not contain NUL bytes",
                host_protocol::CLIPBOARD_WRITE_TEXT_METHOD,
            )
        );
    }

    #[test]
    fn write_html_rejects_nul_before_unsupported() {
        assert_eq!(
            write_html(Some(json!({ "html": "<p>bad\u{0000}</p>" }))).expect_err("html"),
            HostProtocolError::invalid_argument(
                "html",
                "must not contain NUL bytes",
                host_protocol::CLIPBOARD_WRITE_HTML_METHOD,
            )
        );
    }

    #[test]
    fn write_image_rejects_mismatched_mime_before_unsupported() {
        assert_eq!(
            write_image(Some(json!({
                "mime": "image/png",
                "bytes": [255, 216, 255, 0]
            })))
            .expect_err("image"),
            HostProtocolError::invalid_argument(
                "bytes",
                "must match declared image MIME header",
                host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD,
            )
        );
    }

    #[test]
    fn valid_clipboard_mutations_return_typed_unsupported() {
        assert_eq!(
            write_text(Some(json!({ "text": "hello" }))).expect_err("text"),
            HostProtocolError::unsupported(
                host_protocol::CLIPBOARD_UNSUPPORTED_REASON,
                host_protocol::CLIPBOARD_WRITE_TEXT_METHOD,
            )
        );
        assert_eq!(
            write_html(Some(json!({ "html": "<p>hello</p>" }))).expect_err("html"),
            HostProtocolError::unsupported(
                host_protocol::CLIPBOARD_UNSUPPORTED_REASON,
                host_protocol::CLIPBOARD_WRITE_HTML_METHOD,
            )
        );
        assert_eq!(
            clear(None).expect_err("clear"),
            HostProtocolError::unsupported(
                host_protocol::CLIPBOARD_UNSUPPORTED_REASON,
                host_protocol::CLIPBOARD_CLEAR_METHOD,
            )
        );
    }

    #[test]
    fn read_text_rejects_unexpected_payload_before_unsupported() {
        assert_eq!(
            read_text(Some(json!({ "unexpected": true }))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::CLIPBOARD_READ_TEXT_METHOD,
            )
        );
    }

    #[test]
    fn is_supported_reports_unimplemented_adapter_for_all_capabilities() {
        for capability in [
            ClipboardCapabilityPayload::Text,
            ClipboardCapabilityPayload::Html,
            ClipboardCapabilityPayload::Image,
            ClipboardCapabilityPayload::Clear,
            ClipboardCapabilityPayload::Selection,
        ] {
            let payload =
                serde_json::to_value(host_protocol::ClipboardIsSupportedPayload::new(capability))
                    .expect("support payload should encode");
            let encoded = is_supported(Some(payload)).expect("support should encode");
            let decoded = serde_json::from_value::<ClipboardSupportedPayload>(
                encoded.expect("support should return payload"),
            )
            .expect("support should decode");

            assert!(!decoded.is_supported());
            assert_eq!(
                decoded.reason(),
                Some(host_protocol::CLIPBOARD_UNSUPPORTED_REASON)
            );
        }
    }
}

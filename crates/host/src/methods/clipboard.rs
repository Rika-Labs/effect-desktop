#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    ClipboardCapabilityPayload, ClipboardHtmlPayload, ClipboardImagePayload,
    ClipboardIsSupportedPayload, ClipboardSupportedPayload, ClipboardTextPayload,
    HostProtocolError, HostProtocolPlatform,
};
use image::ImageEncoder;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::{
    borrow::Cow,
    sync::{Mutex, MutexGuard},
};

static CLIPBOARD: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);

const PNG_HEADER: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER: &[u8] = &[0xff, 0xd8, 0xff];
const CLIPBOARD_UNAVAILABLE_REASON: &str = "host-clipboard-unavailable";
const CLIPBOARD_BUSY_RESOURCE: &str = "system-clipboard";

pub(crate) fn read_text(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CLIPBOARD_READ_TEXT_METHOD)?;
    let text = with_clipboard(host_protocol::CLIPBOARD_READ_TEXT_METHOD, |clipboard| {
        clipboard.get_text()
    })?;
    encode_payload(
        ClipboardTextPayload::new(text),
        host_protocol::CLIPBOARD_READ_TEXT_METHOD,
    )
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
    with_clipboard(host_protocol::CLIPBOARD_WRITE_TEXT_METHOD, |clipboard| {
        clipboard.set_text(input.text())
    })?;
    Ok(None)
}

pub(crate) fn read_html(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CLIPBOARD_READ_HTML_METHOD)?;
    let html = with_clipboard(host_protocol::CLIPBOARD_READ_HTML_METHOD, |clipboard| {
        clipboard.get().html()
    })?;
    encode_payload(
        ClipboardHtmlPayload::new(html),
        host_protocol::CLIPBOARD_READ_HTML_METHOD,
    )
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
    with_clipboard(host_protocol::CLIPBOARD_WRITE_HTML_METHOD, |clipboard| {
        clipboard.set_html(input.html(), None)
    })?;
    Ok(None)
}

pub(crate) fn read_image(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CLIPBOARD_READ_IMAGE_METHOD)?;
    let image = with_clipboard(host_protocol::CLIPBOARD_READ_IMAGE_METHOD, |clipboard| {
        clipboard.get_image()
    })?;
    let bytes = encode_png(image, host_protocol::CLIPBOARD_READ_IMAGE_METHOD)?;
    encode_payload(
        ClipboardImagePayload::new("image/png", bytes),
        host_protocol::CLIPBOARD_READ_IMAGE_METHOD,
    )
}

pub(crate) fn write_image(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ClipboardImagePayload>(
        payload,
        host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD,
    )?;
    validate_image(&input, host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD)?;
    let image = decode_image(&input, host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD)?;
    with_clipboard(host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD, |clipboard| {
        clipboard.set_image(image)
    })?;
    Ok(None)
}

pub(crate) fn clear(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CLIPBOARD_CLEAR_METHOD)?;
    with_clipboard(host_protocol::CLIPBOARD_CLEAR_METHOD, |clipboard| {
        clipboard.clear()
    })?;
    Ok(None)
}

pub(crate) fn is_supported(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ClipboardIsSupportedPayload>(
        payload,
        host_protocol::CLIPBOARD_IS_SUPPORTED_METHOD,
    )?;
    let support = match input.capability() {
        ClipboardCapabilityPayload::Selection => {
            ClipboardSupportedPayload::unsupported(host_protocol::CLIPBOARD_UNSUPPORTED_REASON)
        }
        ClipboardCapabilityPayload::Text
        | ClipboardCapabilityPayload::Html
        | ClipboardCapabilityPayload::Image
        | ClipboardCapabilityPayload::Clear => match ensure_clipboard_available() {
            Ok(()) => ClipboardSupportedPayload::supported(),
            Err(reason) => ClipboardSupportedPayload::unsupported(reason),
        },
    };
    encode_payload(support, host_protocol::CLIPBOARD_IS_SUPPORTED_METHOD)
}

fn with_clipboard<T>(
    operation: &'static str,
    f: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>,
) -> Result<T, HostProtocolError> {
    let mut guard = clipboard_guard(operation)?;
    if guard.is_none() {
        *guard =
            Some(arboard::Clipboard::new().map_err(|error| clipboard_error(error, operation))?);
    }
    let clipboard = guard
        .as_mut()
        .ok_or_else(|| HostProtocolError::internal("clipboard was not initialized", operation))?;
    f(clipboard).map_err(|error| clipboard_error(error, operation))
}

fn ensure_clipboard_available() -> Result<(), &'static str> {
    match clipboard_guard(host_protocol::CLIPBOARD_IS_SUPPORTED_METHOD) {
        Ok(mut guard) => {
            if guard.is_none() {
                match arboard::Clipboard::new() {
                    Ok(clipboard) => {
                        *guard = Some(clipboard);
                        Ok(())
                    }
                    Err(error) => Err(clipboard_support_reason(&error)),
                }
            } else {
                Ok(())
            }
        }
        Err(_) => Err(CLIPBOARD_UNAVAILABLE_REASON),
    }
}

fn clipboard_guard(
    operation: &'static str,
) -> Result<MutexGuard<'static, Option<arboard::Clipboard>>, HostProtocolError> {
    CLIPBOARD
        .lock()
        .map_err(|_| HostProtocolError::internal("clipboard state lock was poisoned", operation))
}

fn clipboard_error(error: arboard::Error, operation: &'static str) -> HostProtocolError {
    match error {
        arboard::Error::ClipboardNotSupported => {
            HostProtocolError::unsupported(CLIPBOARD_UNAVAILABLE_REASON, operation)
        }
        arboard::Error::ClipboardOccupied => HostProtocolError::ResourceBusy {
            resource: CLIPBOARD_BUSY_RESOURCE.to_string(),
            message: "system clipboard is busy".to_string(),
            operation: operation.to_string(),
            platform: Some(current_platform()),
            code: Some("clipboard-occupied".to_string()),
            cause: None,
            recoverable: HostProtocolError::recoverable_default("ResourceBusy").expect("known tag"),
            remediation: None,
            docs_url: None,
        },
        arboard::Error::ContentNotAvailable => HostProtocolError::InvalidState {
            current: "content-unavailable".to_string(),
            attempted: operation.to_string(),
            message: format!("clipboard content is unavailable for {operation}"),
            operation: operation.to_string(),
            platform: Some(current_platform()),
            code: Some("clipboard-content-unavailable".to_string()),
            cause: None,
            recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
            remediation: None,
            docs_url: None,
        },
        arboard::Error::ConversionFailure => HostProtocolError::InvalidState {
            current: "content-conversion-failed".to_string(),
            attempted: operation.to_string(),
            message: format!("clipboard content could not be converted for {operation}"),
            operation: operation.to_string(),
            platform: Some(current_platform()),
            code: Some("clipboard-conversion-failed".to_string()),
            cause: None,
            recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
            remediation: None,
            docs_url: None,
        },
        arboard::Error::Unknown { description } => unknown_clipboard_error(description, operation),
        _ => unknown_clipboard_error("unclassified clipboard error".to_string(), operation),
    }
}

fn unknown_clipboard_error(description: String, operation: &'static str) -> HostProtocolError {
    HostProtocolError::HostUnavailable {
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: Some("clipboard-unknown".to_string()),
        cause: None,
        recoverable: HostProtocolError::recoverable_default("HostUnavailable").expect("known tag"),
        remediation: None,
        docs_url: None,
        message: format!("clipboard host failed: {description}"),
    }
}

fn clipboard_support_reason(error: &arboard::Error) -> &'static str {
    match error {
        arboard::Error::ClipboardNotSupported => CLIPBOARD_UNAVAILABLE_REASON,
        arboard::Error::ClipboardOccupied => "host-clipboard-busy",
        arboard::Error::ContentNotAvailable
        | arboard::Error::ConversionFailure
        | arboard::Error::Unknown { .. } => CLIPBOARD_UNAVAILABLE_REASON,
        _ => CLIPBOARD_UNAVAILABLE_REASON,
    }
}

fn decode_image(
    image: &ClipboardImagePayload,
    operation: &'static str,
) -> Result<arboard::ImageData<'static>, HostProtocolError> {
    let format = image_format(image.mime(), operation)?;
    let decoded = image::load_from_memory_with_format(image.bytes(), format).map_err(|error| {
        HostProtocolError::invalid_argument(
            "bytes",
            format!("must decode as declared image MIME: {error}"),
            operation,
        )
    })?;
    let rgba = decoded.to_rgba8();
    let (width, height) = rgba.dimensions();
    let width = usize::try_from(width).map_err(|_| {
        HostProtocolError::invalid_argument("bytes", "image width is not supported", operation)
    })?;
    let height = usize::try_from(height).map_err(|_| {
        HostProtocolError::invalid_argument("bytes", "image height is not supported", operation)
    })?;
    Ok(arboard::ImageData {
        width,
        height,
        bytes: Cow::Owned(rgba.into_raw()),
    })
}

fn encode_png(
    image: arboard::ImageData<'static>,
    operation: &'static str,
) -> Result<Vec<u8>, HostProtocolError> {
    let width = u32::try_from(image.width).map_err(|_| {
        HostProtocolError::invalid_output(operation, "clipboard image width is too large")
    })?;
    let height = u32::try_from(image.height).map_err(|_| {
        HostProtocolError::invalid_output(operation, "clipboard image height is too large")
    })?;
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(
            image.bytes.as_ref(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| {
            HostProtocolError::invalid_output(
                operation,
                format!("clipboard image could not be encoded as PNG: {error}"),
            )
        })?;
    Ok(bytes)
}

fn image_format(
    mime: &str,
    operation: &'static str,
) -> Result<image::ImageFormat, HostProtocolError> {
    match mime {
        "image/png" => Ok(image::ImageFormat::Png),
        "image/jpeg" => Ok(image::ImageFormat::Jpeg),
        _ => Err(HostProtocolError::invalid_argument(
            "mime",
            "must be image/png or image/jpeg",
            operation,
        )),
    }
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

fn current_platform() -> HostProtocolPlatform {
    if cfg!(target_os = "macos") {
        HostProtocolPlatform::Macos
    } else if cfg!(windows) {
        HostProtocolPlatform::Windows
    } else {
        HostProtocolPlatform::Linux
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clear, clipboard_error, decode_image, encode_png, image_format, is_supported, read_text,
        write_html, write_image, write_text,
    };
    use host_protocol::{
        ClipboardCapabilityPayload, ClipboardSupportedPayload, ClipboardTextPayload,
        HostProtocolError,
    };
    use image::ImageEncoder;
    use serde_json::json;
    use std::borrow::Cow;

    #[test]
    fn write_text_rejects_nul_before_host_access() {
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
    fn write_html_rejects_nul_before_host_access() {
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
    fn write_image_rejects_mismatched_mime_before_host_access() {
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
    fn read_text_rejects_unexpected_payload_before_host_access() {
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
    fn is_supported_reports_selection_unsupported() {
        let payload = serde_json::to_value(host_protocol::ClipboardIsSupportedPayload::new(
            ClipboardCapabilityPayload::Selection,
        ))
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

    #[test]
    fn text_round_trips_when_host_clipboard_is_available() {
        let payload = serde_json::to_value(host_protocol::ClipboardIsSupportedPayload::new(
            ClipboardCapabilityPayload::Text,
        ))
        .expect("support payload should encode");
        let encoded = is_supported(Some(payload)).expect("support should encode");
        let supported = serde_json::from_value::<ClipboardSupportedPayload>(
            encoded.expect("support should return payload"),
        )
        .expect("support should decode");
        if !supported.is_supported() {
            return;
        }

        write_text(Some(json!({ "text": "effect desktop clipboard smoke" })))
            .expect("text write should succeed");
        let response = read_text(None)
            .expect("text read should succeed")
            .expect("text read should return payload");
        let text =
            serde_json::from_value::<ClipboardTextPayload>(response).expect("text should decode");
        assert_eq!(text.text(), "effect desktop clipboard smoke");
        clear(None).expect("clear should succeed");
    }

    #[test]
    fn clipboard_errors_map_to_typed_host_errors() {
        assert_eq!(
            clipboard_error(
                arboard::Error::ClipboardNotSupported,
                host_protocol::CLIPBOARD_READ_TEXT_METHOD,
            ),
            HostProtocolError::unsupported(
                super::CLIPBOARD_UNAVAILABLE_REASON,
                host_protocol::CLIPBOARD_READ_TEXT_METHOD,
            )
        );
        assert!(matches!(
            clipboard_error(
                arboard::Error::ClipboardOccupied,
                host_protocol::CLIPBOARD_WRITE_TEXT_METHOD,
            ),
            HostProtocolError::ResourceBusy { .. }
        ));
        assert!(matches!(
            clipboard_error(
                arboard::Error::ContentNotAvailable,
                host_protocol::CLIPBOARD_READ_HTML_METHOD,
            ),
            HostProtocolError::InvalidState { .. }
        ));
    }

    #[test]
    fn image_decode_accepts_png_contract_bytes() {
        let payload = host_protocol::ClipboardImagePayload::new("image/png", tiny_png_bytes());
        let image =
            decode_image(&payload, host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD).expect("image");

        assert_eq!(image.width, 1);
        assert_eq!(image.height, 1);
        assert_eq!(image.bytes.as_ref().len(), 4);
    }

    #[test]
    fn image_encode_returns_png_contract_bytes() {
        let image = arboard::ImageData {
            width: 1,
            height: 1,
            bytes: Cow::Owned(vec![255, 0, 0, 255]),
        };
        let encoded =
            encode_png(image, host_protocol::CLIPBOARD_READ_IMAGE_METHOD).expect("png bytes");

        assert!(encoded.starts_with(super::PNG_HEADER));
    }

    #[test]
    fn image_format_rejects_unknown_mime() {
        assert_eq!(
            image_format("image/gif", host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD)
                .expect_err("mime"),
            HostProtocolError::invalid_argument(
                "mime",
                "must be image/png or image/jpeg",
                host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD,
            )
        );
    }

    fn tiny_png_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(&[255, 0, 0, 255], 1, 1, image::ExtendedColorType::Rgba8)
            .expect("png should encode");
        bytes
    }
}

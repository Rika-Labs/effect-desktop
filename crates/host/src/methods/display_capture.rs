#![allow(clippy::result_large_err)]

use host_protocol::{
    DisplayCaptureActorPayload, DisplayCaptureImagePayload, DisplayCaptureMetadataPayload,
    DisplayCaptureRegionPayload, DisplayCaptureRequestPayload, DisplayCaptureResultPayload,
    DisplayCaptureSource, DisplayCaptureSupportedPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[cfg(target_os = "macos")]
use std::process::Command;

pub(crate) fn capture_display(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DisplayCaptureRequestPayload>(
        payload,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
    )?;
    validate_request(
        &input,
        DisplayCaptureSource::Display,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
    )?;
    capture_with_platform(
        &input,
        DisplayCaptureSource::Display,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
    )
}

pub(crate) fn capture_window(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DisplayCaptureRequestPayload>(
        payload,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD,
    )?;
    validate_request(
        &input,
        DisplayCaptureSource::Window,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD,
    )?;
    capture_with_platform(
        &input,
        DisplayCaptureSource::Window,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD,
    )
}

pub(crate) fn capture_region(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DisplayCaptureRequestPayload>(
        payload,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD,
    )?;
    validate_request(
        &input,
        DisplayCaptureSource::Region,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD,
    )?;
    capture_with_platform(
        &input,
        DisplayCaptureSource::Region,
        host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    #[cfg(target_os = "macos")]
    {
        encode_payload(
            DisplayCaptureSupportedPayload::supported(),
            host_protocol::DISPLAY_CAPTURE_IS_SUPPORTED_METHOD,
        )
    }

    #[cfg(not(target_os = "macos"))]
    encode_payload(
        DisplayCaptureSupportedPayload::unsupported(
            host_protocol::DISPLAY_CAPTURE_UNSUPPORTED_REASON,
        ),
        host_protocol::DISPLAY_CAPTURE_IS_SUPPORTED_METHOD,
    )
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
            format!("failed to encode display capture payload: {error}"),
            operation,
        )
    })
}

fn validate_request(
    input: &DisplayCaptureRequestPayload,
    source: DisplayCaptureSource,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_non_empty("grant.id", input.grant().id(), operation)?;
    if let Some(reason) = input.grant().reason() {
        validate_non_empty("grant.reason", reason, operation)?;
    }
    validate_trace_id(input.trace_id(), operation)?;
    validate_target(input, source, operation)
}

fn validate_actor(
    actor: &DisplayCaptureActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_target(
    input: &DisplayCaptureRequestPayload,
    source: DisplayCaptureSource,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let target = input.target();
    if target.source() != source {
        return Err(HostProtocolError::invalid_argument(
            "target.source",
            "must match capture method",
            operation,
        ));
    }

    match source {
        DisplayCaptureSource::Display => {
            validate_required("target.displayId", target.display_id(), operation)?;
            reject_present("target.windowId", target.window_id(), operation)?;
            reject_region(target.region_payload(), operation)
        }
        DisplayCaptureSource::Window => {
            validate_required("target.windowId", target.window_id(), operation)?;
            reject_present("target.displayId", target.display_id(), operation)?;
            reject_region(target.region_payload(), operation)
        }
        DisplayCaptureSource::Region => {
            validate_required("target.displayId", target.display_id(), operation)?;
            reject_present("target.windowId", target.window_id(), operation)?;
            let region = target.region_payload().ok_or_else(|| {
                HostProtocolError::invalid_argument("target.region", "is required", operation)
            })?;
            validate_region(region.values(), operation)
        }
    }
}

fn validate_required(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let value = value
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "is required", operation))?;
    validate_non_empty(field, value, operation)
}

fn reject_present(
    field: &str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_some() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be present for this capture source",
            operation,
        ));
    }
    Ok(())
}

fn reject_region(
    value: Option<&host_protocol::DisplayCaptureRegionPayload>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_some() {
        return Err(HostProtocolError::invalid_argument(
            "target.region",
            "must not be present for this capture source",
            operation,
        ));
    }
    Ok(())
}

fn validate_region(
    (_x, _y, width, height): (f64, f64, f64, f64),
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(HostProtocolError::invalid_argument(
            "target.region",
            "width and height must be finite positive numbers",
            operation,
        ));
    }
    if !_x.is_finite() || !_y.is_finite() {
        return Err(HostProtocolError::invalid_argument(
            "target.region",
            "x and y must be finite numbers",
            operation,
        ));
    }
    Ok(())
}

fn validate_trace_id(
    trace_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(trace_id) = trace_id {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_no_nul(field, value, operation)?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_printable_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_no_nul(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL",
            operation,
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::DISPLAY_CAPTURE_UNSUPPORTED_REASON, operation)
}

trait CaptureCommandRunner {
    fn run(
        &self,
        args: &[String],
        output_path: &Path,
        operation: &'static str,
    ) -> Result<(), HostProtocolError>;
}

#[cfg(target_os = "macos")]
struct MacOsScreencaptureRunner;

#[cfg(target_os = "macos")]
impl CaptureCommandRunner for MacOsScreencaptureRunner {
    fn run(
        &self,
        args: &[String],
        output_path: &Path,
        operation: &'static str,
    ) -> Result<(), HostProtocolError> {
        let output = Command::new("/usr/sbin/screencapture")
            .args(args)
            .arg(output_path)
            .output()
            .map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to invoke macOS screencapture: {error}"),
                    operation,
                )
            })?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_ascii_lowercase().contains("denied")
            || stderr.to_ascii_lowercase().contains("permission")
            || stderr.to_ascii_lowercase().contains("not authorized")
        {
            return Err(HostProtocolError::PermissionDenied {
                capability: "native.invoke:DisplayCapture".to_string(),
                resource: Some("display-capture".to_string()),
                message: "macOS denied screen capture access".to_string(),
                operation: operation.to_string(),
                platform: Some(host_protocol::HostProtocolPlatform::Macos),
                code: output.status.code().map(|code| code.to_string()),
                cause: None,
                recoverable: HostProtocolError::recoverable_default("PermissionDenied")
                    .expect("known tag"),
                remediation: Some(
                    "Grant Screen Recording permission to the app in macOS System Settings"
                        .to_string(),
                ),
                docs_url: None,
            });
        }

        Err(HostProtocolError::internal(
            format!("macOS screencapture failed: {stderr}"),
            operation,
        ))
    }
}

fn capture_with_platform(
    input: &DisplayCaptureRequestPayload,
    source: DisplayCaptureSource,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    #[cfg(target_os = "macos")]
    {
        capture_with_runner(input, source, operation, &MacOsScreencaptureRunner)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = input;
        let _ = source;
        Err(unsupported(operation))
    }
}

fn capture_with_runner(
    input: &DisplayCaptureRequestPayload,
    source: DisplayCaptureSource,
    operation: &'static str,
    runner: &dyn CaptureCommandRunner,
) -> Result<Option<Value>, HostProtocolError> {
    let args = build_screencapture_args(input, source, operation)?;
    let capture_id = format!("display-capture-{}", Uuid::now_v7());
    let output_path = std::env::temp_dir().join(format!("{capture_id}.png"));

    runner.run(&args, &output_path, operation)?;
    let bytes = fs::read(&output_path).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to read display capture output: {error}"),
            operation,
        )
    })?;
    let _ = fs::remove_file(&output_path);

    if bytes.is_empty() {
        return Err(HostProtocolError::invalid_output(
            operation,
            "capture output was empty",
        ));
    }
    if !bytes.starts_with(&[137, 80, 78, 71]) {
        return Err(HostProtocolError::invalid_output(
            operation,
            "capture output was not a PNG image",
        ));
    }

    let metadata = metadata_for_capture(input, source, &capture_id, bytes.len() as u64)?;
    encode_payload(
        DisplayCaptureResultPayload::new(
            DisplayCaptureImagePayload::new("image/png", bytes),
            metadata,
        ),
        operation,
    )
}

fn build_screencapture_args(
    input: &DisplayCaptureRequestPayload,
    source: DisplayCaptureSource,
    operation: &'static str,
) -> Result<Vec<String>, HostProtocolError> {
    let mut args = vec!["-x".to_string(), "-t".to_string(), "png".to_string()];
    let target = input.target();

    match source {
        DisplayCaptureSource::Display => {
            push_display_selector(&mut args, target.display_id(), operation)?;
        }
        DisplayCaptureSource::Window => {
            let window_id = target.window_id().ok_or_else(|| {
                HostProtocolError::invalid_argument("target.windowId", "is required", operation)
            })?;
            let window_id = parse_positive_u32("target.windowId", window_id, operation)?;
            args.push("-l".to_string());
            args.push(window_id.to_string());
        }
        DisplayCaptureSource::Region => {
            push_display_selector(&mut args, target.display_id(), operation)?;
            let region = target.region_payload().ok_or_else(|| {
                HostProtocolError::invalid_argument("target.region", "is required", operation)
            })?;
            args.push("-R".to_string());
            args.push(screencapture_region(region, operation)?);
        }
    }

    Ok(args)
}

fn push_display_selector(
    args: &mut Vec<String>,
    display_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let display_id = display_id.ok_or_else(|| {
        HostProtocolError::invalid_argument("target.displayId", "is required", operation)
    })?;
    if display_id == "main" {
        args.push("-m".to_string());
        return Ok(());
    }
    let display_index = display_id.strip_prefix("display-").unwrap_or(display_id);
    let display_index = parse_positive_u32("target.displayId", display_index, operation)?;
    args.push("-D".to_string());
    args.push(display_index.to_string());
    Ok(())
}

fn parse_positive_u32(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<u32, HostProtocolError> {
    let parsed = value.parse::<u32>().map_err(|_| {
        HostProtocolError::invalid_argument(
            field,
            "must be a positive integer, display-N, or main",
            operation,
        )
    })?;
    if parsed == 0 {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be greater than zero",
            operation,
        ));
    }
    Ok(parsed)
}

fn screencapture_region(
    region: &DisplayCaptureRegionPayload,
    operation: &'static str,
) -> Result<String, HostProtocolError> {
    let (x, y, width, height) = region.values();
    Ok(format!(
        "{},{},{},{}",
        finite_i32("target.region.x", x, operation)?,
        finite_i32("target.region.y", y, operation)?,
        finite_u32("target.region.width", width, operation)?,
        finite_u32("target.region.height", height, operation)?
    ))
}

fn finite_i32(field: &str, value: f64, operation: &'static str) -> Result<i32, HostProtocolError> {
    if !value.is_finite() || value < f64::from(i32::MIN) || value > f64::from(i32::MAX) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must fit in a signed 32-bit screen coordinate",
            operation,
        ));
    }
    Ok(value.round() as i32)
}

fn finite_u32(field: &str, value: f64, operation: &'static str) -> Result<u32, HostProtocolError> {
    if !value.is_finite() || value <= 0.0 || value > f64::from(u32::MAX) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must fit in a positive unsigned 32-bit pixel size",
            operation,
        ));
    }
    Ok(value.round() as u32)
}

fn metadata_for_capture(
    input: &DisplayCaptureRequestPayload,
    source: DisplayCaptureSource,
    capture_id: &str,
    byte_length: u64,
) -> Result<DisplayCaptureMetadataPayload, HostProtocolError> {
    let observed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("system clock is before Unix epoch: {error}"),
                method_for_source(source),
            )
        })?
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);

    let metadata = DisplayCaptureMetadataPayload::new(capture_id, source, byte_length, observed_at);
    Ok(match source {
        DisplayCaptureSource::Display => {
            metadata.with_display_id(input.target().display_id().unwrap_or_default())
        }
        DisplayCaptureSource::Window => {
            metadata.with_window_id(input.target().window_id().unwrap_or_default())
        }
        DisplayCaptureSource::Region => metadata
            .with_display_id(input.target().display_id().unwrap_or_default())
            .with_region(
                input
                    .target()
                    .region_payload()
                    .cloned()
                    .expect("region payload validated before capture"),
            ),
    })
}

fn method_for_source(source: DisplayCaptureSource) -> &'static str {
    match source {
        DisplayCaptureSource::Display => host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
        DisplayCaptureSource::Window => host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD,
        DisplayCaptureSource::Region => host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn capture_display_encodes_png_result_with_redacted_metadata() {
        let input: DisplayCaptureRequestPayload =
            serde_json::from_value(display_request()).expect("fixture should decode");
        let payload = capture_with_runner(
            &input,
            DisplayCaptureSource::Display,
            host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
            &FakeCaptureRunner,
        )
        .expect("fake backend should capture")
        .expect("capture response should include payload");

        assert_eq!(
            payload["image"],
            json!({ "mime": "image/png", "bytes": [137, 80, 78, 71, 13, 10, 26, 10] })
        );
        assert_eq!(payload["metadata"]["source"], "display");
        assert_eq!(payload["metadata"]["displayId"], "display-1");
        assert_eq!(payload["metadata"]["byteLength"], 8);
        assert!(payload["metadata"]["captureId"]
            .as_str()
            .is_some_and(|capture_id| capture_id.starts_with("display-capture-")));
    }

    #[test]
    fn capture_window_rejects_wrong_source_before_unsupported() {
        let invalid = display_request();

        let error = capture_window(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn capture_region_rejects_non_positive_region_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": {
                "source": "region",
                "displayId": "display-1",
                "region": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 10.0 }
            }
        });

        let error = capture_region(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn capture_display_rejects_control_byte_actor_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace\n1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": { "source": "display", "displayId": "display-1" }
        });

        let error = capture_display(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn is_supported_reports_platform_adapter_status() {
        let payload = is_supported()
            .expect("support response should encode")
            .expect("support response should include payload");

        #[cfg(target_os = "macos")]
        assert_eq!(payload, json!({ "supported": true }));

        #[cfg(not(target_os = "macos"))]
        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::DISPLAY_CAPTURE_UNSUPPORTED_REASON
            })
        );
    }

    #[test]
    fn screencapture_args_reject_unmapped_display_ids_before_capture() {
        let input = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": { "source": "display", "displayId": "Screen 1@0,0:1920x1080@2" },
            "traceId": "trace-display-capture"
        });
        let input: DisplayCaptureRequestPayload =
            serde_json::from_value(input).expect("fixture should decode");

        let error = build_screencapture_args(
            &input,
            DisplayCaptureSource::Display,
            host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
        )
        .expect_err("unmapped display id should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn screencapture_args_encode_display_window_and_region_targets() {
        let display: DisplayCaptureRequestPayload =
            serde_json::from_value(display_request()).expect("display fixture should decode");
        let window: DisplayCaptureRequestPayload = serde_json::from_value(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": { "source": "window", "windowId": "42" }
        }))
        .expect("window fixture should decode");
        let region: DisplayCaptureRequestPayload = serde_json::from_value(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": {
                "source": "region",
                "displayId": "main",
                "region": { "x": 1.2, "y": 2.6, "width": 320.0, "height": 240.0 }
            }
        }))
        .expect("region fixture should decode");

        assert_eq!(
            build_screencapture_args(
                &display,
                DisplayCaptureSource::Display,
                host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD
            )
            .expect("display args should encode"),
            vec!["-x", "-t", "png", "-D", "1"]
        );
        assert_eq!(
            build_screencapture_args(
                &window,
                DisplayCaptureSource::Window,
                host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD
            )
            .expect("window args should encode"),
            vec!["-x", "-t", "png", "-l", "42"]
        );
        assert_eq!(
            build_screencapture_args(
                &region,
                DisplayCaptureSource::Region,
                host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD
            )
            .expect("region args should encode"),
            vec!["-x", "-t", "png", "-m", "-R", "1,3,320,240"]
        );
    }

    fn display_request() -> serde_json::Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "grant": { "kind": "policy", "id": "grant-1" },
            "target": { "source": "display", "displayId": "display-1" },
            "traceId": "trace-display-capture"
        })
    }

    struct FakeCaptureRunner;

    impl CaptureCommandRunner for FakeCaptureRunner {
        fn run(
            &self,
            _args: &[String],
            output_path: &Path,
            _operation: &'static str,
        ) -> Result<(), HostProtocolError> {
            fs::write(output_path, [137, 80, 78, 71, 13, 10, 26, 10]).map_err(|error| {
                HostProtocolError::internal(format!("fake capture failed: {error}"), "test")
            })
        }
    }
}

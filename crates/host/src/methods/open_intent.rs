use host_protocol::{AppActivationReasonPayload, AppMetadataLaunchReasonPayload};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LaunchReason {
    Launch,
    OpenFile,
    OpenUrl,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum IntentCandidate {
    Safe(LaunchReason),
    Unsafe,
}

pub(crate) fn app_activation_reason(argv: &[String]) -> AppActivationReasonPayload {
    match classify_argv(argv) {
        LaunchReason::Launch => AppActivationReasonPayload::Launch,
        LaunchReason::OpenFile => AppActivationReasonPayload::OpenFile,
        LaunchReason::OpenUrl => AppActivationReasonPayload::OpenUrl,
        LaunchReason::Unknown => AppActivationReasonPayload::Unknown,
    }
}

pub(crate) fn app_metadata_launch_reason(argv: &[String]) -> AppMetadataLaunchReasonPayload {
    match classify_argv(argv) {
        LaunchReason::Launch => AppMetadataLaunchReasonPayload::Launch,
        LaunchReason::OpenFile => AppMetadataLaunchReasonPayload::OpenFile,
        LaunchReason::OpenUrl => AppMetadataLaunchReasonPayload::OpenUrl,
        LaunchReason::Unknown => AppMetadataLaunchReasonPayload::Unknown,
    }
}

fn classify_argv(argv: &[String]) -> LaunchReason {
    let mut reason = None;
    for argument in argv.iter().skip(1) {
        match classify_argument(argument) {
            Some(IntentCandidate::Safe(candidate)) => {
                if reason.replace(candidate).is_some() {
                    return LaunchReason::Unknown;
                }
            }
            Some(IntentCandidate::Unsafe) => return LaunchReason::Unknown,
            None => {}
        }
    }
    reason.unwrap_or(LaunchReason::Launch)
}

fn classify_argument(argument: &str) -> Option<IntentCandidate> {
    if let Some(candidate) = classify_file_path(argument) {
        return Some(candidate);
    }
    classify_url(argument)
}

fn classify_file_path(value: &str) -> Option<IntentCandidate> {
    if value.is_empty() || has_ascii_control(value) {
        return None;
    }
    if value.starts_with('/') {
        return Some(if has_dot_path_segment(value, &['/']) {
            IntentCandidate::Unsafe
        } else {
            IntentCandidate::Safe(LaunchReason::OpenFile)
        });
    }
    if is_windows_drive_path_like(value) {
        return Some(
            if is_windows_drive_absolute_path(value) && !has_dot_path_segment(value, &['/', '\\']) {
                IntentCandidate::Safe(LaunchReason::OpenFile)
            } else {
                IntentCandidate::Unsafe
            },
        );
    }
    if value.starts_with("\\\\") {
        return Some(
            if is_windows_unc_absolute_path(value) && !has_dot_path_segment(value, &['/', '\\']) {
                IntentCandidate::Safe(LaunchReason::OpenFile)
            } else {
                IntentCandidate::Unsafe
            },
        );
    }
    None
}

fn classify_url(value: &str) -> Option<IntentCandidate> {
    if value.is_empty() || has_ascii_control(value) {
        return None;
    }
    let (scheme, rest) = value.split_once(':')?;
    if !is_url_scheme(scheme) {
        return None;
    }
    if rest.is_empty() || is_dangerous_open_intent_scheme(scheme) {
        return Some(IntentCandidate::Unsafe);
    }
    Some(IntentCandidate::Safe(LaunchReason::OpenUrl))
}

fn is_url_scheme(scheme: &str) -> bool {
    if scheme.len() <= 1 {
        return false;
    }
    let mut chars = scheme.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphabetic()
        && chars.all(|char| char.is_ascii_alphanumeric() || matches!(char, '+' | '-' | '.'))
}

fn is_dangerous_open_intent_scheme(scheme: &str) -> bool {
    matches!(
        scheme.to_ascii_lowercase().as_str(),
        "about" | "blob" | "data" | "file" | "javascript" | "vbscript" | "view-source"
    )
}

fn is_windows_drive_path_like(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn is_windows_drive_absolute_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn is_windows_unc_absolute_path(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("\\\\") else {
        return false;
    };
    let mut segments = rest
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty());
    segments.next().is_some() && segments.next().is_some()
}

fn has_dot_path_segment(value: &str, separators: &[char]) -> bool {
    value
        .split(separators)
        .any(|segment| matches!(segment, "." | ".."))
}

fn has_ascii_control(value: &str) -> bool {
    value.bytes().any(|byte| byte <= 0x1f || byte == 0x7f)
}

#[cfg(test)]
mod tests {
    use super::{app_activation_reason, app_metadata_launch_reason};
    use host_protocol::{AppActivationReasonPayload, AppMetadataLaunchReasonPayload};

    #[test]
    fn launch_reason_defaults_to_launch_without_open_intent() {
        assert_eq!(
            app_activation_reason(&["app".to_string(), "--safe-mode".to_string()]),
            AppActivationReasonPayload::Launch
        );
        assert_eq!(
            app_metadata_launch_reason(&["app".to_string()]),
            AppMetadataLaunchReasonPayload::Launch
        );
    }

    #[test]
    fn launch_reason_detects_safe_absolute_file_intents() {
        for path in [
            "/tmp/README.md",
            "C:\\Users\\me\\README.md",
            "\\\\server\\share\\README.md",
        ] {
            assert_eq!(
                app_activation_reason(&["app".to_string(), path.to_string()]),
                AppActivationReasonPayload::OpenFile
            );
            assert_eq!(
                app_metadata_launch_reason(&[
                    "app".to_string(),
                    "--flag".to_string(),
                    path.to_string()
                ]),
                AppMetadataLaunchReasonPayload::OpenFile
            );
        }
    }

    #[test]
    fn launch_reason_rejects_unsafe_file_intents_as_unknown() {
        for path in [
            "/tmp/../secret.txt",
            "relative.txt",
            "C:relative.txt",
            "\\\\server",
            "\\\\server\\share\\..\\secret.txt",
        ] {
            let expected = if path == "relative.txt" {
                AppActivationReasonPayload::Launch
            } else {
                AppActivationReasonPayload::Unknown
            };
            assert_eq!(
                app_activation_reason(&["app".to_string(), path.to_string()]),
                expected
            );
        }
    }

    #[test]
    fn launch_reason_detects_safe_url_intents() {
        assert_eq!(
            app_activation_reason(&["app".to_string(), "effect-desktop://open".to_string()]),
            AppActivationReasonPayload::OpenUrl
        );
        assert_eq!(
            app_metadata_launch_reason(&["app".to_string(), "https://example.invalid".to_string()]),
            AppMetadataLaunchReasonPayload::OpenUrl
        );
    }

    #[test]
    fn launch_reason_rejects_unsafe_url_intents_as_unknown() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/plain,secret",
            "vbscript:msgbox(1)",
            "view-source:https://example.invalid",
            "effect-desktop:",
        ] {
            assert_eq!(
                app_activation_reason(&["app".to_string(), url.to_string()]),
                AppActivationReasonPayload::Unknown
            );
        }
    }

    #[test]
    fn launch_reason_reports_ambiguous_multiple_intents_as_unknown() {
        assert_eq!(
            app_activation_reason(&[
                "app".to_string(),
                "/tmp/one.txt".to_string(),
                "effect-desktop://open".to_string(),
            ]),
            AppActivationReasonPayload::Unknown
        );
    }
}

#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, HostProtocolPlatform, ShellOpenExternalPayload, ShellOpenPathPayload,
    ShellShowItemInFolderPayload, ShellTrashItemPayload,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::process::Command;

const DEFAULT_EXTERNAL_SCHEMES: &[&str] = &["http", "https", "mailto", "tel"];
const RESERVED_EXTERNAL_SCHEMES: &[&str] = &["file", "javascript"];
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    ".exe", ".bat", ".cmd", ".com", ".scr", ".msi", ".sh", ".ps1", ".vbs", ".wsf", ".js",
    ".desktop", ".lnk", ".url", ".command", ".app",
];

pub(crate) fn open_external(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    open_external_with(payload, &mut execute_shell_command)
}

pub(crate) fn show_item_in_folder(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    show_item_in_folder_with(payload, &mut execute_shell_command)
}

pub(crate) fn open_path(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    open_path_with(payload, &mut execute_shell_command)
}

pub(crate) fn trash_item(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    trash_item_with(payload, &mut execute_shell_command)
}

fn open_external_with(
    payload: Option<Value>,
    runner: &mut impl FnMut(ShellCommand, &'static str) -> Result<(), HostProtocolError>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ShellOpenExternalPayload>(
        payload,
        host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
    )?;
    validate_external_url(&input)?;
    open_external_url(input.url(), runner)?;
    Ok(None)
}

fn show_item_in_folder_with(
    payload: Option<Value>,
    runner: &mut impl FnMut(ShellCommand, &'static str) -> Result<(), HostProtocolError>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ShellShowItemInFolderPayload>(
        payload,
        host_protocol::SHELL_SHOW_ITEM_IN_FOLDER_METHOD,
    )?;
    validate_path(
        input.path(),
        host_protocol::SHELL_SHOW_ITEM_IN_FOLDER_METHOD,
    )?;
    show_path_in_folder(input.path(), runner)?;
    Ok(None)
}

fn open_path_with(
    payload: Option<Value>,
    runner: &mut impl FnMut(ShellCommand, &'static str) -> Result<(), HostProtocolError>,
) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<ShellOpenPathPayload>(payload, host_protocol::SHELL_OPEN_PATH_METHOD)?;
    validate_path(input.path(), host_protocol::SHELL_OPEN_PATH_METHOD)?;
    if is_executable_path(input.path()) && input.allow_executable() != Some(true) {
        return Err(HostProtocolError::unsupported(
            "executable-path-denied",
            host_protocol::SHELL_OPEN_PATH_METHOD,
        ));
    }
    open_filesystem_path(input.path(), runner)?;
    Ok(None)
}

fn trash_item_with(
    payload: Option<Value>,
    runner: &mut impl FnMut(ShellCommand, &'static str) -> Result<(), HostProtocolError>,
) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<ShellTrashItemPayload>(payload, host_protocol::SHELL_TRASH_ITEM_METHOD)?;
    validate_path(input.path(), host_protocol::SHELL_TRASH_ITEM_METHOD)?;
    trash_filesystem_path(input.path(), runner)?;
    Ok(None)
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

fn validate_external_url(input: &ShellOpenExternalPayload) -> Result<(), HostProtocolError> {
    let operation = host_protocol::SHELL_OPEN_EXTERNAL_METHOD;
    if has_control_character(input.url()) || input.url().chars().any(char::is_whitespace) {
        return Err(HostProtocolError::invalid_argument(
            "url",
            "must not contain control characters or whitespace",
            operation,
        ));
    }
    let scheme = url_scheme(input.url()).ok_or_else(|| {
        HostProtocolError::invalid_argument("url", "must include a URL scheme", operation)
    })?;
    let scheme = normalize_scheme(scheme);
    if RESERVED_EXTERNAL_SCHEMES.contains(&scheme.as_str()) {
        return Err(HostProtocolError::unsupported(
            "reserved-url-scheme",
            operation,
        ));
    }
    let allowed = input
        .allowed_schemes()
        .unwrap_or(&[])
        .iter()
        .map(|scheme| normalize_scheme(scheme))
        .chain(
            DEFAULT_EXTERNAL_SCHEMES
                .iter()
                .map(|scheme| (*scheme).to_string()),
        )
        .collect::<Vec<_>>();
    if !allowed.iter().any(|allowed| allowed == &scheme) {
        return Err(HostProtocolError::unsupported(
            "url-scheme-not-allowed",
            operation,
        ));
    }
    validate_url_shape(input.url(), &scheme, operation)?;
    Ok(())
}

fn validate_path(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if path.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must not be empty",
            operation,
        ));
    }
    if has_control_character(path) {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must not contain control characters",
            operation,
        ));
    }
    if contains_shell_metacharacter(path) {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "contains shell metacharacters",
            operation,
        ));
    }
    if path.starts_with('-') {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must not begin with an option prefix",
            operation,
        ));
    }
    if has_parent_traversal(path) {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must not contain parent traversal",
            operation,
        ));
    }
    Ok(())
}

fn url_scheme(url: &str) -> Option<&str> {
    let scheme_end = url.find(':')?;
    if scheme_end == 0 {
        return None;
    }
    let scheme = &url[..scheme_end];
    let mut bytes = scheme.bytes();
    if bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
    {
        Some(scheme)
    } else {
        None
    }
}

fn validate_url_shape(
    url: &str,
    scheme: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if matches!(scheme, "http" | "https") {
        let rest = url.strip_prefix(&format!("{scheme}://")).ok_or_else(|| {
            HostProtocolError::invalid_argument("url", "must include authority", operation)
        })?;
        let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
        if authority.is_empty() {
            return Err(HostProtocolError::invalid_argument(
                "url",
                "must include authority",
                operation,
            ));
        }
    }
    if matches!(scheme, "mailto" | "tel") && url[scheme.len() + 1..].is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "url",
            "must include a value after the scheme",
            operation,
        ));
    }
    Ok(())
}

fn normalize_scheme(scheme: &str) -> String {
    scheme.trim_end_matches(':').to_ascii_lowercase()
}

fn has_control_character(value: &str) -> bool {
    value.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f))
}

fn contains_shell_metacharacter(value: &str) -> bool {
    value
        .bytes()
        .any(|byte| matches!(byte, b';' | b'|' | b'&' | b'>' | b'<' | b'`' | b'\n'))
        || value.contains("$(")
}

fn has_parent_traversal(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
}

fn is_executable_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let executable_extension = EXECUTABLE_EXTENSIONS
        .iter()
        .any(|extension| lower.ends_with(extension));
    executable_extension || is_unix_executable_file(path)
}

#[cfg(unix)]
fn is_unix_executable_file(path: &str) -> bool {
    std::fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_unix_executable_file(_path: &str) -> bool {
    false
}

fn open_external_url(
    url: &str,
    runner: &mut impl FnMut(ShellCommand, &'static str) -> Result<(), HostProtocolError>,
) -> Result<(), HostProtocolError> {
    runner(
        shell_open_command(url),
        host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
    )
}

fn open_filesystem_path(
    path: &str,
    runner: &mut impl FnMut(ShellCommand, &'static str) -> Result<(), HostProtocolError>,
) -> Result<(), HostProtocolError> {
    runner(
        shell_open_command(path),
        host_protocol::SHELL_OPEN_PATH_METHOD,
    )
}

fn show_path_in_folder(
    path: &str,
    runner: &mut impl FnMut(ShellCommand, &'static str) -> Result<(), HostProtocolError>,
) -> Result<(), HostProtocolError> {
    #[cfg(target_os = "macos")]
    {
        runner(
            shell_command("open", ["-R", path]),
            host_protocol::SHELL_SHOW_ITEM_IN_FOLDER_METHOD,
        )
    }

    #[cfg(target_os = "windows")]
    {
        runner(
            shell_command("explorer.exe", [format!("/select,{path}")]),
            host_protocol::SHELL_SHOW_ITEM_IN_FOLDER_METHOD,
        )
    }

    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(path)
            .parent()
            .and_then(std::path::Path::to_str)
            .filter(|parent| !parent.is_empty())
            .unwrap_or(path);
        runner(
            shell_command("xdg-open", [parent]),
            host_protocol::SHELL_SHOW_ITEM_IN_FOLDER_METHOD,
        )
    }
}

fn trash_filesystem_path(
    path: &str,
    runner: &mut impl FnMut(ShellCommand, &'static str) -> Result<(), HostProtocolError>,
) -> Result<(), HostProtocolError> {
    #[cfg(target_os = "macos")]
    {
        runner(
            shell_command(
                "osascript",
                [
                    "-e",
                    "on run argv",
                    "-e",
                    "tell application \"Finder\" to delete POSIX file (item 1 of argv)",
                    "-e",
                    "end run",
                    path,
                ],
            ),
            host_protocol::SHELL_TRASH_ITEM_METHOD,
        )
    }

    #[cfg(target_os = "windows")]
    {
        let _ = path;
        let _ = runner;
        Err(unsupported_with_reason(
            "windows-trash-unavailable",
            host_protocol::SHELL_TRASH_ITEM_METHOD,
        ))
    }

    #[cfg(target_os = "linux")]
    {
        runner(
            shell_command("gio", ["trash", "--", path]),
            host_protocol::SHELL_TRASH_ITEM_METHOD,
        )
    }
}

fn shell_open_command(target: &str) -> ShellCommand {
    #[cfg(target_os = "macos")]
    {
        shell_command("open", [target])
    }

    #[cfg(target_os = "windows")]
    {
        shell_command("rundll32.exe", ["url.dll,FileProtocolHandler", target])
    }

    #[cfg(target_os = "linux")]
    {
        shell_command("xdg-open", [target])
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ShellCommand {
    program: String,
    args: Vec<String>,
}

fn shell_command<I, S>(program: &str, args: I) -> ShellCommand
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    ShellCommand {
        program: program.to_string(),
        args: args.into_iter().map(Into::into).collect(),
    }
}

fn execute_shell_command(
    command: ShellCommand,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let status = Command::new(&command.program)
        .args(&command.args)
        .status()
        .map_err(|error| unsupported_command_error(operation, &command, error))?;
    if status.success() {
        Ok(())
    } else {
        Err(host_unavailable_command_error(
            operation,
            &command,
            status.code(),
        ))
    }
}

#[cfg(target_os = "windows")]
fn unsupported_with_reason(reason: &'static str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::Unsupported {
        reason: reason.to_string(),
        message: format!("unsupported operation {operation}: {reason}"),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: Some(reason.to_string()),
        cause: None,
        recoverable: HostProtocolError::recoverable_default("Unsupported").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn unsupported_command_error(
    operation: &'static str,
    command: &ShellCommand,
    error: std::io::Error,
) -> HostProtocolError {
    HostProtocolError::Unsupported {
        reason: host_protocol::SHELL_UNSUPPORTED_REASON.to_string(),
        message: format!(
            "unsupported operation {operation}: {}",
            host_protocol::SHELL_UNSUPPORTED_REASON
        ),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: error.raw_os_error().map(|code| code.to_string()),
        cause: Some(json!({
            "program": command.program,
            "args": command.args,
            "error": error.to_string()
        })),
        recoverable: HostProtocolError::recoverable_default("Unsupported").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn host_unavailable_command_error(
    operation: &'static str,
    command: &ShellCommand,
    status_code: Option<i32>,
) -> HostProtocolError {
    HostProtocolError::HostUnavailable {
        message: "host is unavailable".to_string(),
        operation: operation.to_string(),
        platform: Some(current_platform()),
        code: Some(
            status_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "terminated-by-signal".to_string()),
        ),
        cause: Some(json!({
            "program": command.program,
            "args": command.args,
            "status": status_code
        })),
        recoverable: HostProtocolError::recoverable_default("HostUnavailable").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn current_platform() -> HostProtocolPlatform {
    if cfg!(target_os = "macos") {
        HostProtocolPlatform::Macos
    } else if cfg!(target_os = "windows") {
        HostProtocolPlatform::Windows
    } else {
        HostProtocolPlatform::Linux
    }
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::execute_shell_command;
    use super::{
        host_unavailable_command_error, is_executable_path, open_external, open_external_with,
        open_path, shell_command, show_item_in_folder_with, trash_item, trash_item_with,
        unsupported_command_error, validate_external_url, validate_path, ShellCommand,
    };
    use host_protocol::{HostProtocolError, ShellOpenExternalPayload};
    use serde_json::json;
    use std::io;

    #[test]
    fn open_external_rejects_reserved_schemes_before_os_handoff() {
        assert_eq!(
            open_external(Some(json!({ "url": "file:///etc/passwd" })))
                .expect_err("reserved scheme"),
            HostProtocolError::unsupported(
                "reserved-url-scheme",
                host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
            )
        );
    }

    #[test]
    fn open_external_requires_explicit_custom_scheme_policy() {
        assert_eq!(
            validate_external_url(&ShellOpenExternalPayload::new("myapp://callback", None)),
            Err(HostProtocolError::unsupported(
                "url-scheme-not-allowed",
                host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
            ))
        );
        assert_eq!(
            validate_external_url(&ShellOpenExternalPayload::new(
                "myapp://callback",
                Some(vec!["MyApp".to_string()]),
            )),
            Ok(())
        );
    }

    #[test]
    fn open_external_rejects_malformed_default_urls() {
        assert_eq!(
            validate_external_url(&ShellOpenExternalPayload::new("https:example.com", None)),
            Err(HostProtocolError::invalid_argument(
                "url",
                "must include authority",
                host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
            ))
        );
        assert_eq!(
            validate_external_url(&ShellOpenExternalPayload::new("https://", None)),
            Err(HostProtocolError::invalid_argument(
                "url",
                "must include authority",
                host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
            ))
        );
    }

    #[test]
    fn path_inputs_reject_traversal_control_bytes_metacharacters_and_option_prefixes() {
        assert_eq!(
            validate_path("../secret", host_protocol::SHELL_OPEN_PATH_METHOD),
            Err(HostProtocolError::invalid_argument(
                "path",
                "must not contain parent traversal",
                host_protocol::SHELL_OPEN_PATH_METHOD,
            ))
        );
        assert_eq!(
            validate_path(
                "C:\\Temp\\..\\secret",
                host_protocol::SHELL_OPEN_PATH_METHOD
            ),
            Err(HostProtocolError::invalid_argument(
                "path",
                "must not contain parent traversal",
                host_protocol::SHELL_OPEN_PATH_METHOD,
            ))
        );
        assert_eq!(
            validate_path("/tmp/a\u{0000}", host_protocol::SHELL_OPEN_PATH_METHOD),
            Err(HostProtocolError::invalid_argument(
                "path",
                "must not contain control characters",
                host_protocol::SHELL_OPEN_PATH_METHOD,
            ))
        );
        assert_eq!(
            validate_path("/tmp/a;rm", host_protocol::SHELL_OPEN_PATH_METHOD),
            Err(HostProtocolError::invalid_argument(
                "path",
                "contains shell metacharacters",
                host_protocol::SHELL_OPEN_PATH_METHOD,
            ))
        );
        assert_eq!(
            validate_path("-a", host_protocol::SHELL_OPEN_PATH_METHOD),
            Err(HostProtocolError::invalid_argument(
                "path",
                "must not begin with an option prefix",
                host_protocol::SHELL_OPEN_PATH_METHOD,
            ))
        );
    }

    #[test]
    fn open_path_rejects_executables_without_explicit_policy() {
        assert!(is_executable_path("/tmp/install.sh"));
        assert!(is_executable_path("C:\\Temp\\shortcut.lnk"));
        assert_eq!(
            open_path(Some(json!({ "path": "/tmp/install.sh" }))).expect_err("executable"),
            HostProtocolError::unsupported(
                "executable-path-denied",
                host_protocol::SHELL_OPEN_PATH_METHOD,
            )
        );
    }

    #[test]
    fn shell_methods_dispatch_to_injected_runner_after_validation() {
        let mut calls = Vec::<(String, Vec<String>, &'static str)>::new();
        let mut runner = |command: ShellCommand, operation| {
            calls.push((command.program, command.args, operation));
            Ok(())
        };

        open_external_with(
            Some(json!({ "url": "https://example.com/docs" })),
            &mut runner,
        )
        .expect("valid external URL should dispatch");
        show_item_in_folder_with(Some(json!({ "path": "/tmp/report.txt" })), &mut runner)
            .expect("valid show item request should dispatch");
        trash_item_with(Some(json!({ "path": "/tmp/report.txt" })), &mut runner).unwrap_or_else(
            |error| {
                if cfg!(target_os = "windows") {
                    assert!(matches!(error, HostProtocolError::Unsupported { .. }));
                    None
                } else {
                    panic!("trash should dispatch on this platform: {error:?}");
                }
            },
        );

        assert!(calls
            .iter()
            .any(|(_, _, operation)| *operation == host_protocol::SHELL_OPEN_EXTERNAL_METHOD));
        assert!(
            calls
                .iter()
                .any(|(_, _, operation)| *operation
                    == host_protocol::SHELL_SHOW_ITEM_IN_FOLDER_METHOD)
        );
        if !cfg!(target_os = "windows") {
            assert!(calls
                .iter()
                .any(|(_, _, operation)| *operation == host_protocol::SHELL_TRASH_ITEM_METHOD));
        }
    }

    #[test]
    fn shell_command_failures_include_platform_and_command_context() {
        let command = shell_command("effect-desktop-shell-test", ["--flag"]);
        let unsupported = unsupported_command_error(
            host_protocol::SHELL_OPEN_PATH_METHOD,
            &command,
            io::Error::new(io::ErrorKind::NotFound, "missing"),
        );
        match unsupported {
            HostProtocolError::Unsupported {
                platform,
                cause: Some(cause),
                ..
            } => {
                assert!(platform.is_some());
                assert_eq!(
                    cause.get("program"),
                    Some(&json!("effect-desktop-shell-test"))
                );
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }

        let host_unavailable = host_unavailable_command_error(
            host_protocol::SHELL_OPEN_PATH_METHOD,
            &command,
            Some(2),
        );
        match host_unavailable {
            HostProtocolError::HostUnavailable {
                platform,
                code,
                cause: Some(cause),
                ..
            } => {
                assert!(platform.is_some());
                assert_eq!(code.as_deref(), Some("2"));
                assert_eq!(cause.get("args"), Some(&json!(["--flag"])));
            }
            other => panic!("expected HostUnavailable, got {other:?}"),
        }
    }

    #[test]
    fn execute_shell_command_maps_success_and_nonzero_status() {
        #[cfg(unix)]
        {
            execute_shell_command(shell_command("true", [] as [&str; 0]), "Shell.test")
                .expect("true should succeed");
            assert!(matches!(
                execute_shell_command(shell_command("false", [] as [&str; 0]), "Shell.test"),
                Err(HostProtocolError::HostUnavailable { .. })
            ));
        }
    }

    #[test]
    fn trash_item_rejects_malformed_payload_before_os_handoff() {
        assert_eq!(
            trash_item(Some(json!({ "path": "" }))).expect_err("empty path"),
            HostProtocolError::invalid_argument(
                "path",
                "must not be empty",
                host_protocol::SHELL_TRASH_ITEM_METHOD,
            )
        );
    }
}

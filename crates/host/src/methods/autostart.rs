#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    AutostartEnablePayload, AutostartEventPayload, AutostartEventPhasePayload,
    AutostartMechanismPayload, AutostartStatusPayload, HostProtocolEnvelope, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::fs;
use std::{
    env,
    path::{Path, PathBuf},
    sync::mpsc::Sender,
};
use uuid::Uuid;

#[cfg(test)]
pub(crate) static AUTOSTART_TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

const AUTOSTART_APP_ID_ENV: &str = "EFFECT_DESKTOP_AUTOSTART_APP_ID";
const AUTOSTART_APP_NAME_ENV: &str = "EFFECT_DESKTOP_AUTOSTART_APP_NAME";
const AUTOSTART_EXE_ENV: &str = "EFFECT_DESKTOP_AUTOSTART_EXE";
#[cfg(any(test, target_os = "macos", target_os = "linux"))]
const AUTOSTART_ROOT_ENV: &str = "EFFECT_DESKTOP_AUTOSTART_ROOT";
const APP_ID_ENV: &str = "EFFECT_DESKTOP_APP_ID";
const DEFAULT_APP_ID: &str = "dev.effect-desktop.host";
const DEFAULT_APP_NAME: &str = "Effect Desktop Host";

#[cfg(test)]
pub(crate) fn is_enabled(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    is_enabled_with_event_sender(payload, None)
}

pub(crate) fn is_enabled_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::AUTOSTART_IS_ENABLED_METHOD)?;
    with_event(
        event_sender,
        AutostartEventPhasePayload::Checked,
        host_protocol::AUTOSTART_IS_ENABLED_METHOD,
        || status_payload(host_protocol::AUTOSTART_IS_ENABLED_METHOD),
    )
}

#[cfg(test)]
pub(crate) fn enable(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    enable_with_event_sender(payload, None)
}

pub(crate) fn enable_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(
        payload.as_ref(),
        "args",
        host_protocol::AUTOSTART_ENABLE_METHOD,
    )?;
    let input = decode_payload::<AutostartEnablePayload>(
        payload.unwrap_or_else(|| Value::Object(Default::default())),
        host_protocol::AUTOSTART_ENABLE_METHOD,
    )?;
    if let Some(args) = input.args() {
        for arg in args {
            validate_arg(arg, host_protocol::AUTOSTART_ENABLE_METHOD)?;
        }
    }
    with_event(
        event_sender,
        AutostartEventPhasePayload::Enabled,
        host_protocol::AUTOSTART_ENABLE_METHOD,
        || {
            platform_enable(
                input.args().unwrap_or(&[]),
                host_protocol::AUTOSTART_ENABLE_METHOD,
            )?;
            status_payload(host_protocol::AUTOSTART_ENABLE_METHOD)
        },
    )
}

#[cfg(test)]
pub(crate) fn disable(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    disable_with_event_sender(payload, None)
}

pub(crate) fn disable_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::AUTOSTART_DISABLE_METHOD)?;
    with_event(
        event_sender,
        AutostartEventPhasePayload::Disabled,
        host_protocol::AUTOSTART_DISABLE_METHOD,
        || {
            platform_disable(host_protocol::AUTOSTART_DISABLE_METHOD)?;
            status_payload(host_protocol::AUTOSTART_DISABLE_METHOD)
        },
    )
}

fn with_event(
    event_sender: Option<Sender<HostProtocolEnvelope>>,
    success_phase: AutostartEventPhasePayload,
    operation: &'static str,
    action: impl FnOnce() -> Result<AutostartStatusPayload, HostProtocolError>,
) -> Result<Option<Value>, HostProtocolError> {
    match action() {
        Ok(status) => {
            send_event(
                event_sender,
                AutostartEventPayload::new(success_phase, Some(status.mechanism()), None),
            );
            encode_payload(status, operation)
        }
        Err(error) => {
            send_event(
                event_sender,
                AutostartEventPayload::new(
                    AutostartEventPhasePayload::Failed,
                    Some(current_mechanism()),
                    Some(error.tag().to_string()),
                ),
            );
            Err(error)
        }
    }
}

fn status_payload(operation: &'static str) -> Result<AutostartStatusPayload, HostProtocolError> {
    Ok(AutostartStatusPayload::new(
        platform_is_enabled(operation)?,
        current_mechanism(),
    ))
}

fn decode_payload<T: DeserializeOwned>(
    payload: Value,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload)
        .map(Some)
        .map_err(|error| HostProtocolError::invalid_output(operation, error.to_string()))
}

fn reject_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Object(object)) if object.is_empty() => Ok(()),
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

fn validate_arg(arg: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if arg.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "args",
            "entries must be non-empty",
            operation,
        ));
    }
    if arg.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            "args",
            "entries must not contain control characters",
            operation,
        ));
    }
    Ok(())
}

fn send_event(sender: Option<Sender<HostProtocolEnvelope>>, payload: AutostartEventPayload) {
    let Some(sender) = sender else {
        return;
    };
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::AUTOSTART_EVENT.to_string(),
        timestamp: 0,
        trace_id: format!("autostart-event-{}", Uuid::now_v7()),
        window_id: None,
        payload: to_value(payload).ok(),
    });
}

fn app_context(operation: &'static str) -> Result<AutostartAppContext, HostProtocolError> {
    let app_id = env::var(AUTOSTART_APP_ID_ENV)
        .or_else(|_| env::var(APP_ID_ENV))
        .unwrap_or_else(|_| DEFAULT_APP_ID.to_string());
    validate_identifier("appId", &app_id, operation)?;
    let app_name =
        env::var(AUTOSTART_APP_NAME_ENV).unwrap_or_else(|_| DEFAULT_APP_NAME.to_string());
    validate_display_string("appName", &app_name, operation)?;
    let executable = match env::var_os(AUTOSTART_EXE_ENV) {
        Some(path) => PathBuf::from(path),
        None => env::current_exe().map_err(|error| {
            host_unavailable(
                format!("failed to resolve current executable for {operation}: {error}"),
                operation,
            )
        })?,
    };
    if !executable.is_absolute() {
        return Err(HostProtocolError::invalid_argument(
            "executable",
            "must be absolute",
            operation,
        ));
    }
    validate_path_text("executable", &executable, operation)?;

    Ok(AutostartAppContext {
        app_id,
        app_name,
        executable,
    })
}

fn validate_identifier(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let valid = !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
    if valid {
        Ok(())
    } else {
        Err(HostProtocolError::invalid_argument(
            field,
            "must contain only ASCII letters, digits, '.', '-', or '_'",
            operation,
        ))
    }
}

fn validate_display_string(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty and contain no control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_path_text(
    field: &'static str,
    path: &Path,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let text = path.to_string_lossy();
    if text.is_empty() || text.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must contain no control characters",
            operation,
        ));
    }
    Ok(())
}

fn host_unavailable(message: String, operation: &'static str) -> HostProtocolError {
    HostProtocolError::HostUnavailable {
        message,
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("HostUnavailable").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

struct AutostartAppContext {
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    app_id: String,
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    app_name: String,
    executable: PathBuf,
}

#[cfg(target_os = "macos")]
fn current_mechanism() -> AutostartMechanismPayload {
    AutostartMechanismPayload::MacosLoginItem
}

#[cfg(target_os = "windows")]
fn current_mechanism() -> AutostartMechanismPayload {
    AutostartMechanismPayload::WindowsRunKey
}

#[cfg(target_os = "linux")]
fn current_mechanism() -> AutostartMechanismPayload {
    AutostartMechanismPayload::LinuxXdgAutostart
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn current_mechanism() -> AutostartMechanismPayload {
    AutostartMechanismPayload::Unsupported
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn platform_is_enabled(operation: &'static str) -> Result<bool, HostProtocolError> {
    Ok(registration_path(operation)?.is_file())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn platform_disable(operation: &'static str) -> Result<(), HostProtocolError> {
    let path = registration_path(operation)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(host_unavailable(
            format!(
                "failed to remove autostart registration {} for {operation}: {error}",
                path.display()
            ),
            operation,
        )),
    }
}

#[cfg(target_os = "macos")]
fn platform_enable(args: &[String], operation: &'static str) -> Result<(), HostProtocolError> {
    let context = app_context(operation)?;
    let path = registration_path(operation)?;
    let mut program_args = vec![context.executable.to_string_lossy().into_owned()];
    program_args.extend(args.iter().cloned());
    let program_args = program_args
        .iter()
        .map(|arg| format!("    <string>{}</string>", xml_escape(arg)))
        .collect::<Vec<_>>()
        .join("\n");
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{}</string>
  <key>ProgramArguments</key>
  <array>
{}
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
        xml_escape(&context.app_id),
        program_args
    );
    write_registration(&path, body.as_bytes(), operation)
}

#[cfg(target_os = "linux")]
fn platform_enable(args: &[String], operation: &'static str) -> Result<(), HostProtocolError> {
    let context = app_context(operation)?;
    let path = registration_path(operation)?;
    let mut command = vec![desktop_exec_quote(&context.executable.to_string_lossy())];
    command.extend(args.iter().map(|arg| desktop_exec_quote(arg)));
    let body = format!(
        "[Desktop Entry]\nType=Application\nName={}\nExec={}\nX-GNOME-Autostart-enabled=true\n",
        desktop_escape(&context.app_name),
        command.join(" ")
    );
    write_registration(&path, body.as_bytes(), operation)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn registration_path(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    let context = app_context(operation)?;
    Ok(registration_dir(operation)?.join(registration_file_name(&context.app_id)))
}

#[cfg(target_os = "macos")]
fn registration_dir(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if let Some(root) = env::var_os(AUTOSTART_ROOT_ENV).map(PathBuf::from) {
        return Ok(root);
    }
    let home = env::var_os("HOME")
        .ok_or_else(|| host_unavailable(format!("HOME is required for {operation}"), operation))?;
    Ok(PathBuf::from(home).join("Library").join("LaunchAgents"))
}

#[cfg(target_os = "macos")]
fn registration_file_name(app_id: &str) -> String {
    format!("{app_id}.plist")
}

#[cfg(target_os = "linux")]
fn registration_dir(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if let Some(root) = env::var_os(AUTOSTART_ROOT_ENV).map(PathBuf::from) {
        return Ok(root);
    }
    if let Some(config) = env::var_os("XDG_CONFIG_HOME").map(PathBuf::from) {
        return Ok(config.join("autostart"));
    }
    let home = env::var_os("HOME")
        .ok_or_else(|| host_unavailable(format!("HOME is required for {operation}"), operation))?;
    Ok(PathBuf::from(home).join(".config").join("autostart"))
}

#[cfg(target_os = "linux")]
fn registration_file_name(app_id: &str) -> String {
    format!("{app_id}.desktop")
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn write_registration(
    path: &Path,
    content: &[u8],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(parent) = path.parent() else {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "registration path must have a parent directory",
            operation,
        ));
    };
    fs::create_dir_all(parent).map_err(|error| {
        host_unavailable(
            format!(
                "failed to create autostart directory {} for {operation}: {error}",
                parent.display()
            ),
            operation,
        )
    })?;
    let temp_path = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("registration")
    ));
    fs::write(&temp_path, content).map_err(|error| {
        host_unavailable(
            format!(
                "failed to write autostart registration {} for {operation}: {error}",
                temp_path.display()
            ),
            operation,
        )
    })?;
    fs::rename(&temp_path, path).map_err(|error| {
        host_unavailable(
            format!(
                "failed to promote autostart registration {} for {operation}: {error}",
                path.display()
            ),
            operation,
        )
    })
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "linux")]
fn desktop_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\n', "\\n")
}

#[cfg(target_os = "linux")]
fn desktop_exec_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('$', "\\$")
            .replace('`', "\\`")
    )
}

#[cfg(target_os = "windows")]
fn platform_is_enabled(operation: &'static str) -> Result<bool, HostProtocolError> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_VALUE_TYPE,
    };

    let context = app_context(operation)?;
    let mut key: HKEY = std::ptr::null_mut();
    let subkey = wide_null(WINDOWS_RUN_KEY);
    let open_status =
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut key) };
    if open_status != 0 {
        return Ok(false);
    }
    let value_name = wide_null(&context.app_name);
    let mut value_type: REG_VALUE_TYPE = 0;
    let mut byte_len: u32 = 0;
    let status = unsafe {
        RegQueryValueExW(
            key,
            value_name.as_ptr(),
            std::ptr::null_mut(),
            &mut value_type,
            std::ptr::null_mut(),
            &mut byte_len,
        )
    };
    unsafe {
        RegCloseKey(key);
    }
    Ok(status == 0 && byte_len > 0)
}

#[cfg(target_os = "windows")]
fn platform_enable(args: &[String], operation: &'static str) -> Result<(), HostProtocolError> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    let context = app_context(operation)?;
    let mut key: HKEY = std::ptr::null_mut();
    let subkey = wide_null(WINDOWS_RUN_KEY);
    let create_status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            std::ptr::null_mut(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        )
    };
    if create_status != 0 {
        return Err(registry_error(
            "open Windows Run key",
            create_status,
            operation,
        ));
    }
    let command = windows_command(&context.executable, args);
    let command = wide_null(&command);
    let value_name = wide_null(&context.app_name);
    let status = unsafe {
        RegSetValueExW(
            key,
            value_name.as_ptr(),
            0,
            REG_SZ,
            command.as_ptr().cast(),
            (command.len() * std::mem::size_of::<u16>()) as u32,
        )
    };
    unsafe {
        RegCloseKey(key);
    }
    if status == 0 {
        Ok(())
    } else {
        Err(registry_error("write Windows Run value", status, operation))
    }
}

#[cfg(target_os = "windows")]
fn platform_disable(operation: &'static str) -> Result<(), HostProtocolError> {
    use windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
    };

    let context = app_context(operation)?;
    let mut key: HKEY = std::ptr::null_mut();
    let subkey = wide_null(WINDOWS_RUN_KEY);
    let open_status = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    if open_status == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    if open_status != 0 {
        return Err(registry_error(
            "open Windows Run key",
            open_status,
            operation,
        ));
    }
    let value_name = wide_null(&context.app_name);
    let status = unsafe { RegDeleteValueW(key, value_name.as_ptr()) };
    unsafe {
        RegCloseKey(key);
    }
    if status == 0 || status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(registry_error(
            "delete Windows Run value",
            status,
            operation,
        ))
    }
}

#[cfg(target_os = "windows")]
const WINDOWS_RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

#[cfg(target_os = "windows")]
fn windows_command(executable: &Path, args: &[String]) -> String {
    let mut parts = vec![quote_windows_arg(&executable.to_string_lossy())];
    parts.extend(args.iter().map(|arg| quote_windows_arg(arg)));
    parts.join(" ")
}

#[cfg(target_os = "windows")]
fn quote_windows_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(target_os = "windows")]
fn registry_error(action: &str, code: u32, operation: &'static str) -> HostProtocolError {
    host_unavailable(
        format!("failed to {action} for {operation}: Windows error {code}"),
        operation,
    )
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_is_enabled(operation: &'static str) -> Result<bool, HostProtocolError> {
    Err(HostProtocolError::unsupported(
        host_protocol::AUTOSTART_UNSUPPORTED_REASON,
        operation,
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_enable(_args: &[String], operation: &'static str) -> Result<(), HostProtocolError> {
    Err(HostProtocolError::unsupported(
        host_protocol::AUTOSTART_UNSUPPORTED_REASON,
        operation,
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_disable(operation: &'static str) -> Result<(), HostProtocolError> {
    Err(HostProtocolError::unsupported(
        host_protocol::AUTOSTART_UNSUPPORTED_REASON,
        operation,
    ))
}

#[cfg(test)]
mod tests {
    use super::{disable, enable, is_enabled};
    use host_protocol::{
        AutostartMechanismPayload, AutostartStatusPayload, HostProtocolEnvelope, HostProtocolError,
    };
    use serde_json::json;
    use std::{
        env, fs,
        path::{Path, PathBuf},
    };

    #[test]
    fn autostart_requests_read_write_and_remove_registration() {
        let _guard = super::AUTOSTART_TEST_ENV_LOCK.lock().expect("env lock");
        let root = temp_root("roundtrip");
        with_test_env(&root, || {
            let initial = is_enabled(None).expect("initial status");
            assert_status(initial, false);

            let enabled = enable(Some(json!({ "args": ["--hidden"] }))).expect("enable");
            assert_status(enabled, true);
            let registration = registration_file(&root);
            assert!(registration.is_file());
            let body = fs::read_to_string(&registration).expect("registration should be readable");
            assert!(body.contains("--hidden"));

            let checked = is_enabled(None).expect("enabled status");
            assert_status(checked, true);

            let disabled = disable(None).expect("disable");
            assert_status(disabled, false);
            assert!(!registration.exists());
        });
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn autostart_requests_emit_lifecycle_events() {
        let _guard = super::AUTOSTART_TEST_ENV_LOCK.lock().expect("env lock");
        let root = temp_root("events");
        with_test_env(&root, || {
            let (sender, receiver) = std::sync::mpsc::channel();
            super::enable_with_event_sender(Some(json!({ "args": ["--hidden"] })), Some(sender))
                .expect("enable should succeed");
            let event = receiver.recv().expect("autostart event");
            let HostProtocolEnvelope::Event {
                method, payload, ..
            } = event
            else {
                panic!("expected autostart event");
            };
            assert_eq!(method, host_protocol::AUTOSTART_EVENT);
            assert_eq!(
                payload.expect("payload"),
                json!({ "phase": "enabled", "mechanism": mechanism_string() })
            );
        });
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn autostart_requests_reject_invalid_inputs_before_writing() {
        let _guard = super::AUTOSTART_TEST_ENV_LOCK.lock().expect("env lock");
        let root = temp_root("invalid");
        with_test_env(&root, || {
            assert_eq!(
                enable(Some(json!({ "args": null }))).expect_err("null args"),
                HostProtocolError::invalid_argument(
                    "args",
                    "must be omitted instead of null",
                    host_protocol::AUTOSTART_ENABLE_METHOD,
                )
            );
            assert_eq!(
                enable(Some(json!({ "args": [""] })))
                    .expect_err("empty arg")
                    .tag(),
                "InvalidArgument"
            );
            assert_eq!(
                enable(Some(json!({ "args": ["bad\0arg"] })))
                    .expect_err("nul arg")
                    .tag(),
                "InvalidArgument"
            );
            assert_eq!(
                enable(Some(json!({ "args": ["bad\narg"] })))
                    .expect_err("control arg")
                    .tag(),
                "InvalidArgument"
            );
            assert_eq!(
                enable(Some(json!({ "args": ["bad\u{85}arg"] })))
                    .expect_err("unicode control arg")
                    .tag(),
                "InvalidArgument"
            );
            assert_eq!(
                disable(Some(json!({ "unexpected": true }))).expect_err("payload"),
                HostProtocolError::invalid_argument(
                    "payload",
                    "must be omitted",
                    host_protocol::AUTOSTART_DISABLE_METHOD,
                )
            );
            assert!(!registration_file(&root).exists());
        });
        let _ = fs::remove_dir_all(root);
    }

    fn assert_status(payload: Option<serde_json::Value>, enabled: bool) {
        let payload = payload.expect("status payload");
        let status = serde_json::from_value::<AutostartStatusPayload>(payload)
            .expect("status should decode");
        assert_eq!(
            status,
            AutostartStatusPayload::new(enabled, current_test_mechanism())
        );
    }

    fn with_test_env(root: &Path, run: impl FnOnce()) {
        let previous_root = env::var_os(super::AUTOSTART_ROOT_ENV);
        let previous_id = env::var_os(super::AUTOSTART_APP_ID_ENV);
        let previous_name = env::var_os(super::AUTOSTART_APP_NAME_ENV);
        let previous_exe = env::var_os(super::AUTOSTART_EXE_ENV);
        env::set_var(super::AUTOSTART_ROOT_ENV, root);
        env::set_var(
            super::AUTOSTART_APP_ID_ENV,
            "dev.effect-desktop.autostart-test",
        );
        env::set_var(
            super::AUTOSTART_APP_NAME_ENV,
            "Effect Desktop Autostart Test",
        );
        env::set_var(super::AUTOSTART_EXE_ENV, test_exe());
        run();
        restore_env(super::AUTOSTART_ROOT_ENV, previous_root);
        restore_env(super::AUTOSTART_APP_ID_ENV, previous_id);
        restore_env(super::AUTOSTART_APP_NAME_ENV, previous_name);
        restore_env(super::AUTOSTART_EXE_ENV, previous_exe);
    }

    fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
        match value {
            Some(value) => env::set_var(key, value),
            None => env::remove_var(key),
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "effect-desktop-autostart-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ))
    }

    fn test_exe() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Program Files\Effect Desktop\host.exe")
        } else {
            PathBuf::from("/Applications/Effect Desktop.app/Contents/MacOS/host")
        }
    }

    fn registration_file(root: &Path) -> PathBuf {
        let name = if cfg!(target_os = "macos") {
            "dev.effect-desktop.autostart-test.plist"
        } else if cfg!(target_os = "linux") {
            "dev.effect-desktop.autostart-test.desktop"
        } else {
            "dev.effect-desktop.autostart-test"
        };
        root.join(name)
    }

    fn current_test_mechanism() -> AutostartMechanismPayload {
        if cfg!(target_os = "macos") {
            AutostartMechanismPayload::MacosLoginItem
        } else if cfg!(target_os = "windows") {
            AutostartMechanismPayload::WindowsRunKey
        } else if cfg!(target_os = "linux") {
            AutostartMechanismPayload::LinuxXdgAutostart
        } else {
            AutostartMechanismPayload::Unsupported
        }
    }

    fn mechanism_string() -> &'static str {
        if cfg!(target_os = "macos") {
            "macos-login-item"
        } else if cfg!(target_os = "windows") {
            "windows-run-key"
        } else if cfg!(target_os = "linux") {
            "linux-xdg-autostart"
        } else {
            "unsupported"
        }
    }
}

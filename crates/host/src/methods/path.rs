#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{CanonicalPathPayload, HostProtocolError, HostProtocolPlatform};
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const APP_DIR: &str = "effect-desktop";

pub(crate) fn app_data(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    resolve_path_method(
        payload,
        PathKind::AppData,
        host_protocol::PATH_APP_DATA_METHOD,
    )
}

pub(crate) fn cache(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    resolve_path_method(payload, PathKind::Cache, host_protocol::PATH_CACHE_METHOD)
}

pub(crate) fn logs(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    resolve_path_method(payload, PathKind::Logs, host_protocol::PATH_LOGS_METHOD)
}

pub(crate) fn temp(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    resolve_path_method(payload, PathKind::Temp, host_protocol::PATH_TEMP_METHOD)
}

pub(crate) fn home(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    resolve_path_method(payload, PathKind::Home, host_protocol::PATH_HOME_METHOD)
}

pub(crate) fn downloads(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    resolve_path_method(
        payload,
        PathKind::Downloads,
        host_protocol::PATH_DOWNLOADS_METHOD,
    )
}

fn resolve_path_method(
    payload: Option<Value>,
    kind: PathKind,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    validate_no_payload(payload, operation)?;
    encode_path(
        resolve_base_dir(kind, &SystemPathEnvironment, operation)?,
        operation,
    )
}

fn validate_no_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.is_some() {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        ));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PathKind {
    AppData,
    Cache,
    Logs,
    Temp,
    Home,
    Downloads,
}

trait PathEnvironment {
    fn var_os(&self, key: &str) -> Option<OsString>;
    fn temp_dir(&self) -> PathBuf;
    fn known_folder_path(&self, folder: KnownFolder, operation: &'static str) -> Option<PathBuf>;
    fn read_to_string(&self, path: &Path) -> std::io::Result<String>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DesktopPlatform {
    Macos,
    Windows,
    Linux,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum KnownFolder {
    LocalAppData,
    Profile,
    Downloads,
}

struct SystemPathEnvironment;

impl PathEnvironment for SystemPathEnvironment {
    fn var_os(&self, key: &str) -> Option<OsString> {
        std::env::var_os(key)
    }

    fn temp_dir(&self) -> PathBuf {
        std::env::temp_dir()
    }

    fn known_folder_path(&self, folder: KnownFolder, operation: &'static str) -> Option<PathBuf> {
        system_known_folder_path(folder, operation).ok()
    }

    fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
        std::fs::read_to_string(path)
    }
}

fn resolve_base_dir(
    kind: PathKind,
    env: &impl PathEnvironment,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    resolve_base_dir_for_platform(kind, current_desktop_platform(), env, operation)
}

fn resolve_base_dir_for_platform(
    kind: PathKind,
    platform: DesktopPlatform,
    env: &impl PathEnvironment,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    let path = match kind {
        PathKind::AppData => app_data_dir(platform, env, operation),
        PathKind::Cache => cache_dir(platform, env, operation),
        PathKind::Logs => logs_dir(platform, env, operation),
        PathKind::Temp => Ok(env.temp_dir().join(APP_DIR)),
        PathKind::Home => home_dir(platform, env, operation),
        PathKind::Downloads => downloads_dir(platform, env, operation),
    }?;
    validate_resolved_path(&path, kind, operation)?;
    Ok(path)
}

fn app_data_dir(
    platform: DesktopPlatform,
    env: &impl PathEnvironment,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    match platform {
        DesktopPlatform::Macos => Ok(home_dir(platform, env, operation)?
            .join("Library")
            .join("Application Support")
            .join(APP_DIR)),
        DesktopPlatform::Windows => {
            known_folder(env, KnownFolder::LocalAppData, operation).map(|path| path.join(APP_DIR))
        }
        DesktopPlatform::Linux => Ok(env_path(env, "XDG_DATA_HOME")
            .or_else(|| {
                home_dir(platform, env, operation)
                    .ok()
                    .map(|home| home.join(".local").join("share"))
            })
            .ok_or_else(|| unavailable("XDG_DATA_HOME and HOME are unavailable", operation))?
            .join(APP_DIR)),
        DesktopPlatform::Unsupported => Err(unsupported_platform(operation)),
    }
}

fn cache_dir(
    platform: DesktopPlatform,
    env: &impl PathEnvironment,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    match platform {
        DesktopPlatform::Macos => Ok(home_dir(platform, env, operation)?
            .join("Library")
            .join("Caches")
            .join(APP_DIR)),
        DesktopPlatform::Windows => known_folder(env, KnownFolder::LocalAppData, operation)
            .map(|path| path.join(APP_DIR).join("cache")),
        DesktopPlatform::Linux => Ok(env_path(env, "XDG_CACHE_HOME")
            .or_else(|| {
                home_dir(platform, env, operation)
                    .ok()
                    .map(|home| home.join(".cache"))
            })
            .ok_or_else(|| unavailable("XDG_CACHE_HOME and HOME are unavailable", operation))?
            .join(APP_DIR)),
        DesktopPlatform::Unsupported => Err(unsupported_platform(operation)),
    }
}

fn logs_dir(
    platform: DesktopPlatform,
    env: &impl PathEnvironment,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    match platform {
        DesktopPlatform::Macos => Ok(home_dir(platform, env, operation)?
            .join("Library")
            .join("Logs")
            .join(APP_DIR)),
        DesktopPlatform::Windows => known_folder(env, KnownFolder::LocalAppData, operation)
            .map(|path| path.join(APP_DIR).join("logs")),
        DesktopPlatform::Linux => Ok(env_path(env, "XDG_STATE_HOME")
            .or_else(|| {
                home_dir(platform, env, operation)
                    .ok()
                    .map(|home| home.join(".local").join("state"))
            })
            .ok_or_else(|| unavailable("XDG_STATE_HOME and HOME are unavailable", operation))?
            .join(APP_DIR)
            .join("logs")),
        DesktopPlatform::Unsupported => Err(unsupported_platform(operation)),
    }
}

fn home_dir(
    platform: DesktopPlatform,
    env: &impl PathEnvironment,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    match platform {
        DesktopPlatform::Macos | DesktopPlatform::Linux => {
            env_path(env, "HOME").ok_or_else(|| unavailable("HOME is unavailable", operation))
        }
        DesktopPlatform::Windows => known_folder(env, KnownFolder::Profile, operation),
        DesktopPlatform::Unsupported => Err(unsupported_platform(operation)),
    }
}

fn downloads_dir(
    platform: DesktopPlatform,
    env: &impl PathEnvironment,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    match platform {
        DesktopPlatform::Macos => Ok(home_dir(platform, env, operation)?.join("Downloads")),
        DesktopPlatform::Windows => known_folder(env, KnownFolder::Downloads, operation),
        DesktopPlatform::Linux => {
            if let Some(path) = xdg_user_dir(env, "DOWNLOAD") {
                return Ok(path);
            }
            Ok(home_dir(platform, env, operation)?.join("Downloads"))
        }
        DesktopPlatform::Unsupported => Err(unsupported_platform(operation)),
    }
}

fn known_folder(
    env: &impl PathEnvironment,
    folder: KnownFolder,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    env.known_folder_path(folder, operation)
        .ok_or_else(|| unavailable(format!("{folder:?} is unavailable"), operation))
}

fn env_path(env: &impl PathEnvironment, key: &str) -> Option<PathBuf> {
    env.var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn xdg_user_dir(env: &impl PathEnvironment, name: &str) -> Option<PathBuf> {
    xdg_user_dir_from_source(
        env_path(env, "HOME").as_deref(),
        &env.read_to_string(
            &env_path(env, "XDG_CONFIG_HOME")
                .or_else(|| env_path(env, "HOME").map(|home| home.join(".config")))?
                .join("user-dirs.dirs"),
        )
        .ok()?,
        name,
    )
}

fn xdg_user_dir_from_source(home: Option<&Path>, source: &str, name: &str) -> Option<PathBuf> {
    let key = format!("XDG_{name}_DIR");
    for line in source.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some((line_key, value)) = line.split_once('=') else {
            continue;
        };
        if line_key != key {
            continue;
        }
        let value = value.trim().strip_prefix('"')?.strip_suffix('"')?;
        if let Some(rest) = value.strip_prefix("$HOME/") {
            return home.map(|home| home.join(rest));
        }
        return Some(PathBuf::from(value));
    }
    None
}

fn validate_resolved_path(
    path: &Path,
    kind: PathKind,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !path.is_absolute() {
        return Err(invalid_output(
            operation,
            "resolved path must be absolute",
            json!({ "kind": format!("{kind:?}"), "path": path.display().to_string() }),
        ));
    }
    Ok(())
}

fn encode_path(path: PathBuf, operation: &'static str) -> Result<Option<Value>, HostProtocolError> {
    let value = path
        .to_str()
        .ok_or_else(|| invalid_output(operation, "path is not valid UTF-8", json!({})))?;
    if value.is_empty() || value.contains('\0') {
        return Err(invalid_output(
            operation,
            "path must be non-empty and must not contain NUL bytes",
            json!({ "path": value }),
        ));
    }
    serde_json::to_value(CanonicalPathPayload::new(value))
        .map(Some)
        .map_err(|error| invalid_output(operation, error.to_string(), json!({ "path": value })))
}

fn unavailable(reason: impl Into<String>, operation: &'static str) -> HostProtocolError {
    let reason = reason.into();
    HostProtocolError::Unsupported {
        reason: host_protocol::PATH_UNSUPPORTED_REASON.to_string(),
        message: format!("unsupported operation {operation}: {reason}"),
        operation: operation.to_string(),
        platform: current_protocol_platform(),
        code: Some(host_protocol::PATH_UNSUPPORTED_REASON.to_string()),
        cause: Some(json!({ "reason": reason })),
        recoverable: HostProtocolError::recoverable_default("Unsupported").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn unsupported_platform(operation: &'static str) -> HostProtocolError {
    HostProtocolError::Unsupported {
        reason: host_protocol::PATH_UNSUPPORTED_REASON.to_string(),
        message: format!("unsupported operation {operation}: unsupported platform"),
        operation: operation.to_string(),
        platform: None,
        code: Some(host_protocol::PATH_UNSUPPORTED_REASON.to_string()),
        cause: Some(json!({ "reason": "unsupported platform" })),
        recoverable: HostProtocolError::recoverable_default("Unsupported").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn invalid_output(
    operation: &'static str,
    reason: impl Into<String>,
    cause: Value,
) -> HostProtocolError {
    let reason = reason.into();
    HostProtocolError::InvalidOutput {
        method: operation.to_string(),
        reason: reason.clone(),
        message: format!("invalid output from {operation}: {reason}"),
        operation: operation.to_string(),
        platform: current_protocol_platform(),
        code: None,
        cause: Some(cause),
        recoverable: HostProtocolError::recoverable_default("InvalidOutput").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn current_protocol_platform() -> Option<HostProtocolPlatform> {
    if cfg!(target_os = "macos") {
        Some(HostProtocolPlatform::Macos)
    } else if cfg!(target_os = "windows") {
        Some(HostProtocolPlatform::Windows)
    } else if cfg!(target_os = "linux") {
        Some(HostProtocolPlatform::Linux)
    } else {
        None
    }
}

fn current_desktop_platform() -> DesktopPlatform {
    if cfg!(target_os = "macos") {
        DesktopPlatform::Macos
    } else if cfg!(target_os = "windows") {
        DesktopPlatform::Windows
    } else if cfg!(target_os = "linux") {
        DesktopPlatform::Linux
    } else {
        DesktopPlatform::Unsupported
    }
}

#[cfg(target_os = "windows")]
fn system_known_folder_path(
    folder: KnownFolder,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::S_OK;
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};

    let folder_id = match folder {
        KnownFolder::LocalAppData => &windows_sys::Win32::UI::Shell::FOLDERID_LocalAppData,
        KnownFolder::Profile => &windows_sys::Win32::UI::Shell::FOLDERID_Profile,
        KnownFolder::Downloads => &windows_sys::Win32::UI::Shell::FOLDERID_Downloads,
    };
    let mut raw = std::ptr::null_mut();
    let result =
        unsafe { SHGetKnownFolderPath(folder_id, KF_FLAG_DEFAULT, std::ptr::null_mut(), &mut raw) };
    if result != S_OK {
        unsafe { CoTaskMemFree(raw.cast()) };
        return Err(unavailable(
            format!("SHGetKnownFolderPath failed with HRESULT {result}"),
            operation,
        ));
    }
    let mut len = 0;
    unsafe {
        while *raw.add(len) != 0 {
            len += 1;
        }
        let value = std::slice::from_raw_parts(raw, len);
        let path = PathBuf::from(OsString::from_wide(value));
        CoTaskMemFree(raw.cast());
        Ok(path)
    }
}

#[cfg(not(target_os = "windows"))]
fn system_known_folder_path(
    _folder: KnownFolder,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    Err(unavailable(
        "Windows known folders are unavailable on this platform",
        operation,
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        encode_path, resolve_base_dir, resolve_base_dir_for_platform, validate_no_payload,
        xdg_user_dir_from_source, DesktopPlatform, KnownFolder, PathEnvironment, PathKind,
    };
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::ffi::OsString;
    use std::path::Path;
    use std::path::PathBuf;

    #[test]
    fn resolves_current_platform_base_directories_from_environment() {
        let env = FakePathEnvironment::new()
            .with_var("HOME", "/home/alice")
            .with_var("XDG_DATA_HOME", "/data/alice")
            .with_var("XDG_CACHE_HOME", "/cache/alice")
            .with_var("XDG_STATE_HOME", "/state/alice")
            .with_temp("/tmp")
            .with_file(
                "/home/alice/.config/user-dirs.dirs",
                r#"XDG_DOWNLOAD_DIR="$HOME/Files""#,
            );

        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                resolve_base_dir(PathKind::AppData, &env, host_protocol::PATH_APP_DATA_METHOD)
                    .expect("app data"),
                PathBuf::from("/home/alice/Library/Application Support/effect-desktop")
            );
            assert_eq!(
                resolve_base_dir(
                    PathKind::Downloads,
                    &env,
                    host_protocol::PATH_DOWNLOADS_METHOD
                )
                .expect("downloads"),
                PathBuf::from("/home/alice/Downloads")
            );
        }

        #[cfg(target_os = "linux")]
        {
            assert_eq!(
                resolve_base_dir(PathKind::AppData, &env, host_protocol::PATH_APP_DATA_METHOD)
                    .expect("app data"),
                PathBuf::from("/data/alice/effect-desktop")
            );
            assert_eq!(
                resolve_base_dir(PathKind::Cache, &env, host_protocol::PATH_CACHE_METHOD)
                    .expect("cache"),
                PathBuf::from("/cache/alice/effect-desktop")
            );
            assert_eq!(
                resolve_base_dir(PathKind::Logs, &env, host_protocol::PATH_LOGS_METHOD)
                    .expect("logs"),
                PathBuf::from("/state/alice/effect-desktop/logs")
            );
            assert_eq!(
                resolve_base_dir(
                    PathKind::Downloads,
                    &env,
                    host_protocol::PATH_DOWNLOADS_METHOD
                )
                .expect("downloads"),
                PathBuf::from("/home/alice/Files")
            );
        }

        assert_eq!(
            resolve_base_dir(PathKind::Temp, &env, host_protocol::PATH_TEMP_METHOD).expect("temp"),
            PathBuf::from("/tmp/effect-desktop")
        );
        assert_eq!(
            resolve_base_dir(PathKind::Home, &env, host_protocol::PATH_HOME_METHOD).expect("home"),
            PathBuf::from("/home/alice")
        );
    }

    #[test]
    fn resolves_platform_base_directory_matrix_with_mock_environment() {
        let env = FakePathEnvironment::new()
            .with_var("HOME", "/home/alice")
            .with_var("XDG_DATA_HOME", "/data/alice")
            .with_var("XDG_CACHE_HOME", "/cache/alice")
            .with_var("XDG_STATE_HOME", "/state/alice")
            .with_known_folder(KnownFolder::LocalAppData, "/Users/Alice/AppData/Local")
            .with_known_folder(KnownFolder::Profile, "/Users/Alice")
            .with_known_folder(KnownFolder::Downloads, "/Users/Alice/Downloads")
            .with_temp("/tmp")
            .with_file(
                "/home/alice/.config/user-dirs.dirs",
                r#"XDG_DOWNLOAD_DIR="$HOME/Files""#,
            );

        let cases = [
            (
                DesktopPlatform::Macos,
                PathKind::AppData,
                host_protocol::PATH_APP_DATA_METHOD,
                "/home/alice/Library/Application Support/effect-desktop",
            ),
            (
                DesktopPlatform::Macos,
                PathKind::Cache,
                host_protocol::PATH_CACHE_METHOD,
                "/home/alice/Library/Caches/effect-desktop",
            ),
            (
                DesktopPlatform::Macos,
                PathKind::Logs,
                host_protocol::PATH_LOGS_METHOD,
                "/home/alice/Library/Logs/effect-desktop",
            ),
            (
                DesktopPlatform::Macos,
                PathKind::Home,
                host_protocol::PATH_HOME_METHOD,
                "/home/alice",
            ),
            (
                DesktopPlatform::Macos,
                PathKind::Downloads,
                host_protocol::PATH_DOWNLOADS_METHOD,
                "/home/alice/Downloads",
            ),
            (
                DesktopPlatform::Windows,
                PathKind::AppData,
                host_protocol::PATH_APP_DATA_METHOD,
                "/Users/Alice/AppData/Local/effect-desktop",
            ),
            (
                DesktopPlatform::Windows,
                PathKind::Cache,
                host_protocol::PATH_CACHE_METHOD,
                "/Users/Alice/AppData/Local/effect-desktop/cache",
            ),
            (
                DesktopPlatform::Windows,
                PathKind::Logs,
                host_protocol::PATH_LOGS_METHOD,
                "/Users/Alice/AppData/Local/effect-desktop/logs",
            ),
            (
                DesktopPlatform::Windows,
                PathKind::Home,
                host_protocol::PATH_HOME_METHOD,
                "/Users/Alice",
            ),
            (
                DesktopPlatform::Windows,
                PathKind::Downloads,
                host_protocol::PATH_DOWNLOADS_METHOD,
                "/Users/Alice/Downloads",
            ),
            (
                DesktopPlatform::Linux,
                PathKind::AppData,
                host_protocol::PATH_APP_DATA_METHOD,
                "/data/alice/effect-desktop",
            ),
            (
                DesktopPlatform::Linux,
                PathKind::Cache,
                host_protocol::PATH_CACHE_METHOD,
                "/cache/alice/effect-desktop",
            ),
            (
                DesktopPlatform::Linux,
                PathKind::Logs,
                host_protocol::PATH_LOGS_METHOD,
                "/state/alice/effect-desktop/logs",
            ),
            (
                DesktopPlatform::Linux,
                PathKind::Home,
                host_protocol::PATH_HOME_METHOD,
                "/home/alice",
            ),
            (
                DesktopPlatform::Linux,
                PathKind::Downloads,
                host_protocol::PATH_DOWNLOADS_METHOD,
                "/home/alice/Files",
            ),
        ];

        for (platform, kind, operation, expected) in cases {
            assert_eq!(
                resolve_base_dir_for_platform(kind, platform, &env, operation)
                    .unwrap_or_else(|error| panic!("{platform:?} {kind:?} failed: {error:?}")),
                PathBuf::from(expected),
            );
        }
    }

    #[test]
    fn xdg_user_dirs_require_exact_key_match() {
        let source = r#"
            XDG_DOWNLOAD_DIRTY="/tmp/wrong"
            XDG_DOWNLOAD_DIR="$HOME/Downloads"
        "#;

        assert_eq!(
            xdg_user_dir_from_source(Some(Path::new("/home/alice")), source, "DOWNLOAD"),
            Some(PathBuf::from("/home/alice/Downloads")),
        );
    }

    #[test]
    fn unsupported_platform_errors_do_not_claim_supported_platform() {
        let env = FakePathEnvironment::new().with_temp("/tmp");

        assert!(matches!(
            resolve_base_dir_for_platform(
                PathKind::Home,
                DesktopPlatform::Unsupported,
                &env,
                host_protocol::PATH_HOME_METHOD,
            ),
            Err(HostProtocolError::Unsupported { platform: None, .. })
        ));
    }

    #[test]
    fn missing_base_directory_inputs_return_typed_unsupported() {
        let env = FakePathEnvironment::new().with_temp("/tmp");

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        assert!(matches!(
            resolve_base_dir(PathKind::Home, &env, host_protocol::PATH_HOME_METHOD),
            Err(HostProtocolError::Unsupported {
                platform: Some(_),
                ..
            })
        ));
    }

    #[test]
    fn invalid_base_directory_outputs_are_rejected() {
        let env = FakePathEnvironment::new()
            .with_var("HOME", "relative")
            .with_temp("/tmp");

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        assert!(matches!(
            resolve_base_dir(PathKind::Home, &env, host_protocol::PATH_HOME_METHOD),
            Err(HostProtocolError::InvalidOutput {
                platform: Some(_),
                ..
            })
        ));

        assert!(matches!(
            encode_path(PathBuf::from("/tmp/a\0b"), host_protocol::PATH_TEMP_METHOD),
            Err(HostProtocolError::InvalidOutput {
                platform: Some(_),
                ..
            })
        ));
    }

    #[test]
    fn path_methods_reject_payloads_before_resolution() {
        assert_eq!(
            validate_no_payload(Some(json!({})), host_protocol::PATH_HOME_METHOD),
            Err(HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::PATH_HOME_METHOD,
            ))
        );
    }

    #[derive(Clone, Debug)]
    struct FakePathEnvironment {
        vars: BTreeMap<String, OsString>,
        files: BTreeMap<PathBuf, String>,
        known_folders: BTreeMap<KnownFolder, PathBuf>,
        temp: PathBuf,
    }

    impl FakePathEnvironment {
        fn new() -> Self {
            Self {
                vars: BTreeMap::new(),
                files: BTreeMap::new(),
                known_folders: BTreeMap::new(),
                temp: PathBuf::from("/tmp"),
            }
        }

        fn with_var(mut self, key: &str, value: &str) -> Self {
            self.vars.insert(key.to_string(), OsString::from(value));
            self
        }

        fn with_file(mut self, path: &str, value: &str) -> Self {
            self.files.insert(PathBuf::from(path), value.to_string());
            self
        }

        fn with_known_folder(mut self, folder: KnownFolder, value: &str) -> Self {
            self.known_folders.insert(folder, PathBuf::from(value));
            self
        }

        fn with_temp(mut self, value: &str) -> Self {
            self.temp = PathBuf::from(value);
            self
        }
    }

    impl PathEnvironment for FakePathEnvironment {
        fn var_os(&self, key: &str) -> Option<OsString> {
            self.vars.get(key).cloned()
        }

        fn temp_dir(&self) -> PathBuf {
            self.temp.clone()
        }

        fn known_folder_path(
            &self,
            folder: KnownFolder,
            _operation: &'static str,
        ) -> Option<PathBuf> {
            self.known_folders.get(&folder).cloned()
        }

        fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
            self.files.get(path).cloned().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, path.display().to_string())
            })
        }
    }
}

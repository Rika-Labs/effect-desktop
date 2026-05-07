#![allow(clippy::result_large_err)]
// Windows host polish returns the canonical HostProtocolError enum at the
// native boundary. Boxing it here would make this boundary differ from the
// rest of the host method surface.

use host_protocol::HostProtocolError;
use serde_json::Value;
use std::path::{Path, PathBuf};
#[cfg(any(test, windows))]
use tao::window::Theme;
use tao::window::Window;

const WINDOWS_POLISH_OPERATION: &str = "WindowsPolish";
#[cfg(any(test, windows))]
const ERROR_ACCESS_DENIED_CODE: i32 = 5;
#[cfg(windows)]
const E_INVALIDARG: i32 = 0x80070057_u32 as i32;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WindowsProcessPolish {
    app_user_model_id: String,
}

impl WindowsProcessPolish {
    pub(crate) fn from_env() -> std::result::Result<Option<Self>, HostProtocolError> {
        match std::env::var("EFFECT_DESKTOP_APP_ID") {
            Ok(value) => Self::new(value).map(Some),
            Err(std::env::VarError::NotPresent) => Self::from_current_exe_manifest(),
            Err(error) => Err(HostProtocolError::internal(
                format!("failed to read EFFECT_DESKTOP_APP_ID: {error}"),
                WINDOWS_POLISH_OPERATION,
            )),
        }
    }

    fn from_current_exe_manifest() -> std::result::Result<Option<Self>, HostProtocolError> {
        let current_exe = std::env::current_exe().map_err(|error| {
            HostProtocolError::internal(
                format!("failed to resolve current executable path: {error}"),
                WINDOWS_POLISH_OPERATION,
            )
        })?;
        Self::from_manifest_path(manifest_path_for_exe(&current_exe))
    }

    fn from_manifest_path(
        path: Option<PathBuf>,
    ) -> std::result::Result<Option<Self>, HostProtocolError> {
        let Some(path) = path else {
            return Ok(None);
        };
        if !path.exists() {
            return Ok(None);
        }

        let manifest = std::fs::read_to_string(&path).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to read app manifest {}: {error}", path.display()),
                WINDOWS_POLISH_OPERATION,
            )
        })?;
        let value: Value = serde_json::from_str(&manifest).map_err(|error| {
            HostProtocolError::invalid_argument(
                "app-manifest.json",
                format!("must be valid JSON: {error}"),
                WINDOWS_POLISH_OPERATION,
            )
        })?;
        let Some(app_id) = value.get("id").and_then(Value::as_str) else {
            return Err(HostProtocolError::invalid_argument(
                "app-manifest.json.id",
                "must be a string",
                WINDOWS_POLISH_OPERATION,
            ));
        };

        Self::new(app_id.to_string()).map(Some)
    }

    pub(crate) fn new(app_user_model_id: String) -> std::result::Result<Self, HostProtocolError> {
        let trimmed = app_user_model_id.trim();
        if trimmed.is_empty() {
            return Err(HostProtocolError::invalid_argument(
                "EFFECT_DESKTOP_APP_ID",
                "must not be empty",
                WINDOWS_POLISH_OPERATION,
            ));
        }
        if trimmed.contains('\0') {
            return Err(HostProtocolError::invalid_argument(
                "EFFECT_DESKTOP_APP_ID",
                "must not contain NUL bytes",
                WINDOWS_POLISH_OPERATION,
            ));
        }

        Ok(Self {
            app_user_model_id: trimmed.to_string(),
        })
    }

    #[cfg(test)]
    pub(crate) fn app_user_model_id(&self) -> &str {
        &self.app_user_model_id
    }
}

fn manifest_path_for_exe(exe: &Path) -> Option<PathBuf> {
    exe.parent()?
        .parent()
        .map(|layout| layout.join("app-manifest.json"))
}

#[cfg(any(test, windows))]
fn dark_mode_value(theme: Theme) -> i32 {
    if matches!(theme, Theme::Dark) {
        1
    } else {
        0
    }
}

pub(crate) fn apply_process_polish(
    polish: Option<&WindowsProcessPolish>,
) -> std::result::Result<(), HostProtocolError> {
    platform::apply_process_polish(polish)
}

pub(crate) fn apply_window_polish(window: &Window) -> std::result::Result<(), HostProtocolError> {
    platform::apply_window_polish(window)
}

#[cfg(windows)]
mod platform {
    use super::{HostProtocolError, WindowsProcessPolish, WINDOWS_POLISH_OPERATION};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use tao::{platform::windows::WindowExtWindows, window::Window};
    use tracing::warn;
    use windows_sys::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE},
        UI::{
            HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            Shell::SetCurrentProcessExplicitAppUserModelID,
        },
    };

    pub(super) fn apply_process_polish(
        polish: Option<&WindowsProcessPolish>,
    ) -> std::result::Result<(), HostProtocolError> {
        let dpi_result =
            unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        if dpi_result == 0 {
            if last_os_error_is_access_denied() {
                warn!(
                    event = "host.windows.dpi_awareness_already_set",
                    "Windows DPI awareness was already set before host startup"
                );
            } else {
                return Err(last_os_error("SetProcessDpiAwarenessContext"));
            }
        }

        if let Some(polish) = polish {
            let app_id = wide_null(&polish.app_user_model_id);
            let result = unsafe { SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr()) };
            if result < 0 {
                return Err(HostProtocolError::internal(
                    format!("SetCurrentProcessExplicitAppUserModelID failed: HRESULT {result:#x}"),
                    WINDOWS_POLISH_OPERATION,
                ));
            }
        }

        Ok(())
    }

    pub(super) fn apply_window_polish(
        window: &Window,
    ) -> std::result::Result<(), HostProtocolError> {
        let dark = super::dark_mode_value(window.theme());
        let result = unsafe {
            DwmSetWindowAttribute(
                window.hwnd() as HWND,
                DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
                (&dark as *const i32).cast(),
                std::mem::size_of_val(&dark) as u32,
            )
        };
        if result < 0 {
            warn!(
                event = "host.windows.dark_mode_attribute_unavailable",
                hresult = format!("{result:#x}"),
                unsupported = result == super::E_INVALIDARG,
                "Windows immersive dark-mode window attribute was not applied"
            );
        }
        Ok(())
    }

    fn wide_null(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain([0]).collect()
    }

    fn last_os_error(operation: &'static str) -> HostProtocolError {
        HostProtocolError::internal(
            format!("{operation} failed: {}", std::io::Error::last_os_error()),
            WINDOWS_POLISH_OPERATION,
        )
    }

    fn last_os_error_is_access_denied() -> bool {
        std::io::Error::last_os_error().raw_os_error() == Some(super::ERROR_ACCESS_DENIED_CODE)
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{HostProtocolError, WindowsProcessPolish};
    use tao::window::Window;

    pub(super) fn apply_process_polish(
        _polish: Option<&WindowsProcessPolish>,
    ) -> std::result::Result<(), HostProtocolError> {
        Ok(())
    }

    pub(super) fn apply_window_polish(
        _window: &Window,
    ) -> std::result::Result<(), HostProtocolError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{dark_mode_value, manifest_path_for_exe, WindowsProcessPolish};
    use std::fs;
    use tao::window::Theme;

    #[test]
    fn process_polish_rejects_empty_app_user_model_id() {
        assert!(WindowsProcessPolish::new("  ".to_string()).is_err());
    }

    #[test]
    fn process_polish_trims_app_user_model_id() {
        let polish = WindowsProcessPolish::new(" dev.effect-desktop.playground ".to_string())
            .expect("valid app id");

        assert_eq!(polish.app_user_model_id(), "dev.effect-desktop.playground");
    }

    #[test]
    fn process_polish_rejects_nul_app_user_model_id() {
        assert!(WindowsProcessPolish::new("dev.effect\0desktop".to_string()).is_err());
    }

    #[test]
    fn process_polish_reads_app_id_from_packaged_manifest_path() {
        let root = std::env::temp_dir().join(format!(
            "effect-desktop-windows-polish-{}",
            uuid::Uuid::now_v7()
        ));
        let native = root.join("native");
        fs::create_dir_all(&native).expect("native dir");
        fs::write(
            root.join("app-manifest.json"),
            r#"{"id":"dev.effect-desktop.playground"}"#,
        )
        .expect("app manifest");
        let exe = native.join("host.exe");

        let polish = WindowsProcessPolish::from_manifest_path(manifest_path_for_exe(&exe))
            .expect("manifest app id")
            .expect("polish");

        assert_eq!(polish.app_user_model_id(), "dev.effect-desktop.playground");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn process_polish_rejects_manifest_without_string_app_id() {
        let root = std::env::temp_dir().join(format!(
            "effect-desktop-windows-polish-{}",
            uuid::Uuid::now_v7()
        ));
        let native = root.join("native");
        fs::create_dir_all(&native).expect("native dir");
        fs::write(root.join("app-manifest.json"), r#"{"id":42}"#).expect("app manifest");
        let exe = native.join("host.exe");

        let result = WindowsProcessPolish::from_manifest_path(manifest_path_for_exe(&exe));

        assert!(result.is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn dark_mode_value_follows_theme() {
        assert_eq!(dark_mode_value(Theme::Dark), 1);
        assert_eq!(dark_mode_value(Theme::Light), 0);
    }

    #[test]
    fn access_denied_code_matches_windows_dpi_already_set_error() {
        assert_eq!(super::ERROR_ACCESS_DENIED_CODE, 5);
    }
}

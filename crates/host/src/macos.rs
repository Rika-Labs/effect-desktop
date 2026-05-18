#![allow(clippy::result_large_err)]
// macOS polish returns the canonical HostProtocolError enum at the native
// boundary. Boxing it here would make this boundary differ from host methods.

use host_protocol::{HostProtocolError, WindowTitleBarStyle, WindowTrafficLights};
use serde_json::Value;
use tao::{window::Window, window::WindowBuilder};

const MACOS_POLISH_OPERATION: &str = "MacosPolish";

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MacosWindowPolish {
    title_bar_style: WindowTitleBarStyle,
    vibrancy: Option<MacosVibrancyMaterial>,
    traffic_lights: Option<MacosTrafficLights>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MacosVibrancyMaterial {
    AppearanceBased,
    ContentBackground,
    HeaderView,
    HudWindow,
    Menu,
    Popover,
    Selection,
    Sidebar,
    Titlebar,
    WindowBackground,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MacosTrafficLights {
    x: f64,
    y: f64,
}

impl MacosWindowPolish {
    pub(crate) fn new(
        title_bar_style: Option<WindowTitleBarStyle>,
        vibrancy: Option<&str>,
        traffic_lights: Option<&WindowTrafficLights>,
    ) -> std::result::Result<Option<Self>, HostProtocolError> {
        if title_bar_style.is_none() && vibrancy.is_none() && traffic_lights.is_none() {
            return Ok(None);
        }

        Ok(Some(Self {
            title_bar_style: title_bar_style.unwrap_or(WindowTitleBarStyle::Default),
            vibrancy: vibrancy.map(MacosVibrancyMaterial::parse).transpose()?,
            traffic_lights: traffic_lights
                .map(MacosTrafficLights::try_from)
                .transpose()?,
        }))
    }

    #[cfg(target_os = "macos")]
    fn title_bar_style(&self) -> WindowTitleBarStyle {
        self.title_bar_style
    }

    #[cfg(any(target_os = "macos", test))]
    fn vibrancy(&self) -> Option<MacosVibrancyMaterial> {
        self.vibrancy
    }

    #[cfg(test)]
    fn traffic_lights(&self) -> Option<MacosTrafficLights> {
        self.traffic_lights
    }
}

impl MacosVibrancyMaterial {
    fn parse(value: &str) -> std::result::Result<Self, HostProtocolError> {
        match value.trim() {
            "appearanceBased" | "appearance-based" => Ok(Self::AppearanceBased),
            "contentBackground" | "content-background" => Ok(Self::ContentBackground),
            "headerView" | "header-view" => Ok(Self::HeaderView),
            "hudWindow" | "hud-window" => Ok(Self::HudWindow),
            "menu" => Ok(Self::Menu),
            "popover" => Ok(Self::Popover),
            "selection" => Ok(Self::Selection),
            "sidebar" => Ok(Self::Sidebar),
            "titlebar" => Ok(Self::Titlebar),
            "windowBackground" | "window-background" => Ok(Self::WindowBackground),
            "" => Err(invalid_argument("vibrancy", "must not be empty")),
            _ => Err(invalid_argument(
                "vibrancy",
                "unsupported macOS vibrancy material",
            )),
        }
    }
}

impl TryFrom<&WindowTrafficLights> for MacosTrafficLights {
    type Error = HostProtocolError;

    fn try_from(value: &WindowTrafficLights) -> std::result::Result<Self, Self::Error> {
        if !value.x().is_finite() {
            return Err(invalid_argument("trafficLights.x", "must be finite"));
        }
        if !value.y().is_finite() {
            return Err(invalid_argument("trafficLights.y", "must be finite"));
        }
        if value.x() < 0.0 || value.y() < 0.0 {
            return Err(invalid_argument(
                "trafficLights",
                "offsets must be greater than or equal to zero",
            ));
        }

        Ok(Self {
            x: value.x(),
            y: value.y(),
        })
    }
}

pub(crate) fn apply_window_builder_polish(
    builder: WindowBuilder,
    polish: Option<&MacosWindowPolish>,
) -> WindowBuilder {
    platform::apply_window_builder_polish(builder, polish)
}

pub(crate) fn apply_window_parent(
    builder: WindowBuilder,
    parent: &Window,
) -> std::result::Result<WindowBuilder, HostProtocolError> {
    platform::apply_window_parent(builder, parent)
}

pub(crate) fn apply_window_polish(
    window: &Window,
    polish: Option<&MacosWindowPolish>,
) -> std::result::Result<(), HostProtocolError> {
    platform::apply_window_polish(window, polish)
}

pub(crate) fn set_traffic_lights(
    window: &Window,
    traffic_lights: &WindowTrafficLights,
) -> std::result::Result<(), HostProtocolError> {
    let traffic_lights = MacosTrafficLights::try_from(traffic_lights)?;
    platform::set_traffic_lights(window, traffic_lights)
}

pub(crate) fn set_dock_badge_label(
    window: &Window,
    label: Option<String>,
) -> std::result::Result<(), HostProtocolError> {
    platform::set_dock_badge_label(window, label)
}

pub(crate) fn set_application_menu(template: Value) -> std::result::Result<(), HostProtocolError> {
    platform::set_application_menu(template)
}

pub(crate) fn set_dock_menu(template: Option<Value>) -> std::result::Result<(), HostProtocolError> {
    platform::set_dock_menu(template)
}

fn invalid_argument(field: &str, reason: &str) -> HostProtocolError {
    HostProtocolError::invalid_argument(field, reason, MACOS_POLISH_OPERATION)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{HostProtocolError, MacosTrafficLights, MacosWindowPolish};
    use tao::{
        dpi::LogicalPosition,
        platform::macos::{WindowBuilderExtMacOS, WindowExtMacOS},
        window::{Window, WindowBuilder},
    };

    pub(super) fn apply_window_builder_polish(
        builder: WindowBuilder,
        polish: Option<&MacosWindowPolish>,
    ) -> WindowBuilder {
        let Some(polish) = polish else {
            return builder;
        };

        let builder = match polish.title_bar_style() {
            host_protocol::WindowTitleBarStyle::Default => builder,
            host_protocol::WindowTitleBarStyle::Hidden => builder.with_titlebar_hidden(true),
            host_protocol::WindowTitleBarStyle::HiddenInset => builder
                .with_titlebar_transparent(true)
                .with_fullsize_content_view(true),
            host_protocol::WindowTitleBarStyle::CustomButtonsOnHover => {
                builder.with_titlebar_buttons_hidden(true)
            }
        };

        match polish.traffic_lights {
            Some(traffic_lights) => builder
                .with_traffic_light_inset(LogicalPosition::new(traffic_lights.x, traffic_lights.y)),
            None => builder,
        }
    }

    pub(super) fn apply_window_parent(
        builder: WindowBuilder,
        parent: &Window,
    ) -> std::result::Result<WindowBuilder, HostProtocolError> {
        Ok(builder.with_parent_window(parent.ns_window()))
    }

    pub(super) fn apply_window_polish(
        window: &Window,
        polish: Option<&MacosWindowPolish>,
    ) -> std::result::Result<(), HostProtocolError> {
        if let Some(material) = polish.and_then(MacosWindowPolish::vibrancy) {
            window_vibrancy::apply_vibrancy(
                window,
                vibrancy_material(material),
                Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
                None,
            )
            .map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to apply macOS vibrancy: {error}"),
                    "Window.create",
                )
            })?;
        }
        Ok(())
    }

    pub(super) fn set_traffic_lights(
        window: &Window,
        traffic_lights: MacosTrafficLights,
    ) -> std::result::Result<(), HostProtocolError> {
        WindowExtMacOS::set_traffic_light_inset(
            window,
            LogicalPosition::new(traffic_lights.x, traffic_lights.y),
        );
        Ok(())
    }

    pub(super) fn set_dock_badge_label(
        window: &Window,
        label: Option<String>,
    ) -> std::result::Result<(), HostProtocolError> {
        WindowExtMacOS::set_badge_label(window, label);
        Ok(())
    }

    pub(super) fn set_application_menu(
        template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        let menu = build_menu(&template)?;
        menu.init_for_nsapp();
        Ok(())
    }

    pub(super) fn set_dock_menu(
        _template: Option<serde_json::Value>,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "macOS Dock menu installation requires an NSApplication delegate bridge that is not part of this host adapter yet",
            host_protocol::DOCK_SET_MENU_METHOD,
        ))
    }

    #[allow(deprecated)]
    fn vibrancy_material(
        material: super::MacosVibrancyMaterial,
    ) -> window_vibrancy::NSVisualEffectMaterial {
        match material {
            super::MacosVibrancyMaterial::AppearanceBased => {
                window_vibrancy::NSVisualEffectMaterial::AppearanceBased
            }
            super::MacosVibrancyMaterial::ContentBackground => {
                window_vibrancy::NSVisualEffectMaterial::ContentBackground
            }
            super::MacosVibrancyMaterial::HeaderView => {
                window_vibrancy::NSVisualEffectMaterial::HeaderView
            }
            super::MacosVibrancyMaterial::HudWindow => {
                window_vibrancy::NSVisualEffectMaterial::HudWindow
            }
            super::MacosVibrancyMaterial::Menu => window_vibrancy::NSVisualEffectMaterial::Menu,
            super::MacosVibrancyMaterial::Popover => {
                window_vibrancy::NSVisualEffectMaterial::Popover
            }
            super::MacosVibrancyMaterial::Selection => {
                window_vibrancy::NSVisualEffectMaterial::Selection
            }
            super::MacosVibrancyMaterial::Sidebar => {
                window_vibrancy::NSVisualEffectMaterial::Sidebar
            }
            super::MacosVibrancyMaterial::Titlebar => {
                window_vibrancy::NSVisualEffectMaterial::Titlebar
            }
            super::MacosVibrancyMaterial::WindowBackground => {
                window_vibrancy::NSVisualEffectMaterial::WindowBackground
            }
        }
    }

    fn build_menu(
        template: &serde_json::Value,
    ) -> std::result::Result<muda::Menu, HostProtocolError> {
        let menu = muda::Menu::new();
        let items = template
            .get("items")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| super::invalid_argument("template.items", "must be an array"))?;
        for item in items {
            let submenu = build_submenu(item)?;
            menu.append(&submenu).map_err(menu_error)?;
        }
        Ok(menu)
    }

    fn build_submenu(
        value: &serde_json::Value,
    ) -> std::result::Result<muda::Submenu, HostProtocolError> {
        let label = field_string(value, "label")?;
        let enabled = value
            .get("enabled")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true);
        let submenu = muda::Submenu::with_id(field_string(value, "id")?, label, enabled);
        let items = value
            .get("items")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| super::invalid_argument("items", "submenu items must be an array"))?;
        for item in items {
            match field_string(item, "type")?.as_str() {
                "item" => {
                    let enabled = item
                        .get("enabled")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(true);
                    let menu_item = muda::MenuItem::with_id(
                        field_string(item, "id")?,
                        field_string(item, "label")?,
                        enabled,
                        None,
                    );
                    submenu.append(&menu_item).map_err(menu_error)?;
                }
                "separator" => {
                    let separator = muda::PredefinedMenuItem::separator();
                    submenu.append(&separator).map_err(menu_error)?;
                }
                "submenu" => {
                    let nested = build_submenu(item)?;
                    submenu.append(&nested).map_err(menu_error)?;
                }
                _ => {
                    return Err(super::invalid_argument(
                        "type",
                        "must be item, separator, or submenu",
                    ))
                }
            }
        }
        Ok(submenu)
    }

    fn field_string(
        value: &serde_json::Value,
        field: &str,
    ) -> std::result::Result<String, HostProtocolError> {
        value
            .get(field)
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| super::invalid_argument(field, "must be a string"))
    }

    fn menu_error(error: muda::Error) -> HostProtocolError {
        HostProtocolError::internal(
            format!("failed to build macOS menu: {error}"),
            host_protocol::MENU_SET_APPLICATION_MENU_METHOD,
        )
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{HostProtocolError, MacosWindowPolish};
    use host_protocol;
    use tao::window::{Window, WindowBuilder};

    pub(super) fn apply_window_builder_polish(
        builder: WindowBuilder,
        _polish: Option<&MacosWindowPolish>,
    ) -> WindowBuilder {
        builder
    }

    pub(super) fn apply_window_parent(
        _builder: WindowBuilder,
        _parent: &Window,
    ) -> std::result::Result<WindowBuilder, HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "window parent ownership is not implemented for this host platform",
            host_protocol::WINDOW_CREATE_METHOD,
        ))
    }

    pub(super) fn apply_window_polish(
        _window: &Window,
        _polish: Option<&MacosWindowPolish>,
    ) -> std::result::Result<(), HostProtocolError> {
        Ok(())
    }

    pub(super) fn set_traffic_lights(
        _window: &Window,
        _traffic_lights: super::MacosTrafficLights,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "traffic-light placement is only supported on macOS",
            host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
        ))
    }

    pub(super) fn set_dock_badge_label(
        _window: &Window,
        _label: Option<String>,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "Dock badge labels are macOS-only",
            host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
        ))
    }

    pub(super) fn set_application_menu(
        _template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "application menus are macOS-only in the host adapter",
            host_protocol::MENU_SET_APPLICATION_MENU_METHOD,
        ))
    }

    pub(super) fn set_dock_menu(
        _template: Option<serde_json::Value>,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "Dock menus are macOS-only",
            host_protocol::DOCK_SET_MENU_METHOD,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{MacosTrafficLights, MacosVibrancyMaterial, MacosWindowPolish};
    use host_protocol::{WindowTitleBarStyle, WindowTrafficLights};

    #[test]
    fn absent_polish_returns_none() {
        assert_eq!(
            MacosWindowPolish::new(None, None, None).expect("polish"),
            None
        );
    }

    #[test]
    fn vibrancy_material_accepts_camel_and_kebab_case() {
        let camel = MacosWindowPolish::new(None, Some("windowBackground"), None)
            .expect("valid material")
            .expect("polish");
        let kebab = MacosWindowPolish::new(None, Some("window-background"), None)
            .expect("valid material")
            .expect("polish");

        assert_eq!(
            camel.vibrancy(),
            Some(MacosVibrancyMaterial::WindowBackground)
        );
        assert_eq!(
            kebab.vibrancy(),
            Some(MacosVibrancyMaterial::WindowBackground)
        );
    }

    #[test]
    fn vibrancy_material_rejects_unknown_values() {
        assert!(MacosWindowPolish::new(None, Some("glass"), None).is_err());
    }

    #[test]
    fn traffic_light_offsets_must_be_finite_and_non_negative() {
        assert!(MacosWindowPolish::new(
            Some(WindowTitleBarStyle::HiddenInset),
            None,
            Some(&WindowTrafficLights::new(-1.0, 12.0)),
        )
        .is_err());
        assert!(MacosWindowPolish::new(
            Some(WindowTitleBarStyle::HiddenInset),
            None,
            Some(&WindowTrafficLights::new(f64::NAN, 12.0)),
        )
        .is_err());
    }

    #[test]
    fn traffic_light_offsets_are_recorded() {
        let polish = MacosWindowPolish::new(
            Some(WindowTitleBarStyle::HiddenInset),
            None,
            Some(&WindowTrafficLights::new(12.0, 13.0)),
        )
        .expect("valid offsets")
        .expect("polish");

        assert_eq!(
            polish.traffic_lights(),
            Some(MacosTrafficLights { x: 12.0, y: 13.0 })
        );
    }
}

#![allow(clippy::result_large_err)]
// macOS polish returns the canonical HostProtocolError enum at the native
// boundary. Boxing it here would make this boundary differ from host methods.

use host_protocol::{HostProtocolError, WindowTitleBarStyle, WindowTrafficLights};
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

    fn title_bar_style(&self) -> WindowTitleBarStyle {
        self.title_bar_style
    }

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

pub(crate) fn apply_window_polish(
    window: &Window,
    polish: Option<&MacosWindowPolish>,
) -> std::result::Result<(), HostProtocolError> {
    platform::apply_window_polish(window, polish)
}

pub(crate) fn set_dock_badge_label(
    window: &Window,
    label: Option<String>,
) -> std::result::Result<(), HostProtocolError> {
    platform::set_dock_badge_label(window, label)
}

fn invalid_argument(field: &str, reason: &str) -> HostProtocolError {
    HostProtocolError::invalid_argument(field, reason, MACOS_POLISH_OPERATION)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{HostProtocolError, MacosWindowPolish};
    use tao::{
        dpi::LogicalPosition,
        platform::macos::{WindowBuilderExtMacOS, WindowExtMacOS},
        window::{Window, WindowBuilder},
    };
    use tracing::warn;

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

    pub(super) fn apply_window_polish(
        _window: &Window,
        polish: Option<&MacosWindowPolish>,
    ) -> std::result::Result<(), HostProtocolError> {
        if polish.and_then(MacosWindowPolish::vibrancy).is_some() {
            warn!(
                event = "host.macos.vibrancy_pending_native_effect_view",
                "macOS vibrancy material was validated but NSVisualEffectView attachment is not implemented yet"
            );
        }
        Ok(())
    }

    pub(super) fn set_dock_badge_label(
        window: &Window,
        label: Option<String>,
    ) -> std::result::Result<(), HostProtocolError> {
        WindowExtMacOS::set_badge_label(window, label);
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{HostProtocolError, MacosWindowPolish};
    use tao::window::{Window, WindowBuilder};

    pub(super) fn apply_window_builder_polish(
        builder: WindowBuilder,
        _polish: Option<&MacosWindowPolish>,
    ) -> WindowBuilder {
        builder
    }

    pub(super) fn apply_window_polish(
        _window: &Window,
        _polish: Option<&MacosWindowPolish>,
    ) -> std::result::Result<(), HostProtocolError> {
        Ok(())
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

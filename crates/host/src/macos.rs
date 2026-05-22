#![allow(clippy::result_large_err)]
// macOS polish returns the canonical HostProtocolError enum at the native
// boundary. Boxing it here would make this boundary differ from host methods.

use host_protocol::{HostProtocolError, WindowTitleBarStyle, WindowTrafficLights};
use serde_json::Value;
use tao::{monitor::MonitorHandle, window::Window, window::WindowBuilder};

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
            vibrancy: vibrancy
                .map(|value| MacosVibrancyMaterial::parse(value, MACOS_POLISH_OPERATION))
                .transpose()?,
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
    fn parse(value: &str, operation: &'static str) -> std::result::Result<Self, HostProtocolError> {
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
            "" => Err(invalid_argument_for_operation(
                "vibrancy",
                "must not be empty",
                operation,
            )),
            _ => Err(invalid_argument_for_operation(
                "vibrancy",
                "unsupported macOS vibrancy material",
                operation,
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

#[cfg(target_os = "macos")]
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

pub(crate) fn set_vibrancy(
    window: &Window,
    material: &str,
) -> std::result::Result<(), HostProtocolError> {
    let material =
        MacosVibrancyMaterial::parse(material, host_protocol::WINDOW_SET_VIBRANCY_METHOD)?;
    platform::set_vibrancy(window, material)
}

pub(crate) fn clear_vibrancy(window: &Window) -> std::result::Result<(), HostProtocolError> {
    platform::clear_vibrancy(window)
}

pub(crate) fn set_shadow(
    window: &Window,
    has_shadow: bool,
) -> std::result::Result<(), HostProtocolError> {
    platform::set_shadow(window, has_shadow)
}

pub(crate) fn set_title_bar_style(
    window: &Window,
    title_bar_style: WindowTitleBarStyle,
) -> std::result::Result<(), HostProtocolError> {
    platform::set_title_bar_style(window, title_bar_style)
}

pub(crate) fn set_title_bar_transparent(
    window: &Window,
    title_bar_transparent: bool,
) -> std::result::Result<(), HostProtocolError> {
    platform::set_title_bar_transparent(window, title_bar_transparent)
}

pub(crate) fn set_transparent(
    window: &Window,
    transparent: bool,
) -> std::result::Result<(), HostProtocolError> {
    platform::set_transparent(window, transparent)
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

pub(crate) fn set_window_menu(
    window_id: &str,
    template: Value,
) -> std::result::Result<(), HostProtocolError> {
    platform::set_window_menu(window_id, template)
}

#[cfg(all(target_os = "macos", not(test)))]
pub(crate) fn clear_application_menu() -> std::result::Result<(), HostProtocolError> {
    platform::clear_application_menu()
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MacosScreenWorkArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl MacosScreenWorkArea {
    #[cfg(target_os = "macos")]
    fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub(crate) fn x(&self) -> f64 {
        self.x
    }

    pub(crate) fn y(&self) -> f64 {
        self.y
    }

    pub(crate) fn width(&self) -> f64 {
        self.width
    }

    pub(crate) fn height(&self) -> f64 {
        self.height
    }
}

pub(crate) fn screen_work_area(monitor: &MonitorHandle) -> Option<MacosScreenWorkArea> {
    platform::screen_work_area(monitor)
}

fn invalid_argument(field: &str, reason: &str) -> HostProtocolError {
    invalid_argument_for_operation(field, reason, MACOS_POLISH_OPERATION)
}

fn invalid_argument_for_operation(
    field: &str,
    reason: &str,
    operation: &'static str,
) -> HostProtocolError {
    HostProtocolError::invalid_argument(field, reason, operation)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{
        HostProtocolError, MacosScreenWorkArea, MacosTrafficLights, MacosWindowPolish,
        WindowTitleBarStyle,
    };
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSColor, NSScreen, NSWindow, NSWindowButton, NSWindowStyleMask, NSWindowTitleVisibility,
    };
    use std::ptr::NonNull;
    use tao::{
        dpi::LogicalPosition,
        monitor::MonitorHandle,
        platform::macos::{MonitorHandleExtMacOS, WindowBuilderExtMacOS, WindowExtMacOS},
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

    pub(super) fn set_vibrancy(
        window: &Window,
        material: super::MacosVibrancyMaterial,
    ) -> std::result::Result<(), HostProtocolError> {
        window_vibrancy::apply_vibrancy(
            window,
            vibrancy_material(material),
            Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
            None,
        )
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to apply macOS vibrancy: {error}"),
                host_protocol::WINDOW_SET_VIBRANCY_METHOD,
            )
        })
    }

    pub(super) fn clear_vibrancy(window: &Window) -> std::result::Result<(), HostProtocolError> {
        window_vibrancy::clear_vibrancy(window)
            .map(|_| ())
            .map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to clear macOS vibrancy: {error}"),
                    host_protocol::WINDOW_CLEAR_VIBRANCY_METHOD,
                )
            })
    }

    pub(super) fn set_shadow(
        window: &Window,
        has_shadow: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        WindowExtMacOS::set_has_shadow(window, has_shadow);
        Ok(())
    }

    pub(super) fn set_title_bar_style(
        window: &Window,
        title_bar_style: WindowTitleBarStyle,
    ) -> std::result::Result<(), HostProtocolError> {
        let ns_window = ns_window(window, host_protocol::WINDOW_SET_TITLE_BAR_STYLE_METHOD)?;
        match title_bar_style {
            WindowTitleBarStyle::Default => {
                set_style_mask(ns_window, |mask| {
                    (mask
                        | NSWindowStyleMask::Titled
                        | NSWindowStyleMask::Closable
                        | NSWindowStyleMask::Miniaturizable)
                        & !NSWindowStyleMask::FullSizeContentView
                });
                ns_window.setTitlebarAppearsTransparent(false);
                ns_window.setTitleVisibility(NSWindowTitleVisibility::Visible);
                set_standard_buttons_hidden(ns_window, false);
            }
            WindowTitleBarStyle::Hidden => {
                set_style_mask(ns_window, |mask| {
                    (mask & !NSWindowStyleMask::Titled) & !NSWindowStyleMask::FullSizeContentView
                });
                ns_window.setTitlebarAppearsTransparent(false);
                ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
                set_standard_buttons_hidden(ns_window, true);
            }
            WindowTitleBarStyle::HiddenInset => {
                set_style_mask(ns_window, |mask| {
                    mask | NSWindowStyleMask::Titled
                        | NSWindowStyleMask::Closable
                        | NSWindowStyleMask::Miniaturizable
                        | NSWindowStyleMask::FullSizeContentView
                });
                ns_window.setTitlebarAppearsTransparent(true);
                ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
                set_standard_buttons_hidden(ns_window, false);
            }
            WindowTitleBarStyle::CustomButtonsOnHover => {
                set_style_mask(ns_window, |mask| {
                    (mask
                        | NSWindowStyleMask::Titled
                        | NSWindowStyleMask::Closable
                        | NSWindowStyleMask::Miniaturizable)
                        & !NSWindowStyleMask::FullSizeContentView
                });
                ns_window.setTitlebarAppearsTransparent(false);
                ns_window.setTitleVisibility(NSWindowTitleVisibility::Visible);
                set_standard_buttons_hidden(ns_window, true);
            }
        }
        Ok(())
    }

    pub(super) fn set_title_bar_transparent(
        window: &Window,
        title_bar_transparent: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        WindowExtMacOS::set_titlebar_transparent(window, title_bar_transparent);
        Ok(())
    }

    pub(super) fn set_transparent(
        window: &Window,
        transparent: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let ns_window = ns_window(window, host_protocol::WINDOW_SET_TRANSPARENT_METHOD)?;
        ns_window.setOpaque(!transparent);
        let color = if transparent {
            NSColor::clearColor()
        } else {
            NSColor::windowBackgroundColor()
        };
        ns_window.setBackgroundColor(Some(&color));
        Ok(())
    }

    fn ns_window<'window>(
        window: &'window Window,
        operation: &'static str,
    ) -> std::result::Result<&'window NSWindow, HostProtocolError> {
        let pointer = window.ns_window();
        let Some(pointer) = NonNull::new(pointer) else {
            return Err(HostProtocolError::internal(
                "tao returned a null NSWindow pointer",
                operation,
            ));
        };

        // Safety: Tao's macOS `WindowExtMacOS::ns_window` contract returns the
        // live `NSWindow` backing this `Window` until the `Window` is destroyed.
        Ok(unsafe { pointer.cast::<NSWindow>().as_ref() })
    }

    fn set_style_mask(
        ns_window: &NSWindow,
        update: impl FnOnce(NSWindowStyleMask) -> NSWindowStyleMask,
    ) {
        ns_window.setStyleMask(update(ns_window.styleMask()));
    }

    fn set_standard_buttons_hidden(ns_window: &NSWindow, hidden: bool) {
        for titlebar_button in &[
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::CloseButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(*titlebar_button) {
                button.setHidden(hidden);
            }
        }
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
        let mut bindings = Vec::new();
        let menu = build_menu(&template, None, &mut bindings)?;
        menu.init_for_nsapp();
        crate::window::replace_menu_command_bindings(
            bindings,
            host_protocol::MENU_SET_APPLICATION_MENU_METHOD,
        )?;
        Ok(())
    }

    pub(super) fn set_window_menu(
        window_id: &str,
        template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        let mut bindings = Vec::new();
        let menu = build_menu(&template, Some(window_id), &mut bindings)?;
        menu.init_for_nsapp();
        crate::window::replace_menu_command_bindings(
            bindings,
            host_protocol::MENU_SET_WINDOW_MENU_METHOD,
        )?;
        Ok(())
    }

    #[cfg_attr(test, allow(dead_code))]
    pub(super) fn clear_application_menu() -> std::result::Result<(), HostProtocolError> {
        let menu = muda::Menu::new();
        menu.init_for_nsapp();
        crate::window::replace_menu_command_bindings(Vec::new(), host_protocol::MENU_CLEAR_METHOD)?;
        Ok(())
    }

    pub(super) fn screen_work_area(monitor: &MonitorHandle) -> Option<MacosScreenWorkArea> {
        let screen = monitor.ns_screen()?;
        // SAFETY: Tao returns this pointer with Retained::into_raw, transferring a
        // retain count to the caller; from_raw balances that ownership locally.
        let screen = unsafe { Retained::<NSScreen>::from_raw(screen.cast::<NSScreen>())? };
        let scale = monitor.scale_factor();
        let visible_frame = screen.visibleFrame();

        Some(MacosScreenWorkArea::new(
            visible_frame.origin.x * scale,
            visible_frame.origin.y * scale,
            visible_frame.size.width * scale,
            visible_frame.size.height * scale,
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
        window_id: Option<&str>,
        bindings: &mut Vec<(String, crate::window::MenuCommandBinding)>,
    ) -> std::result::Result<muda::Menu, HostProtocolError> {
        let menu = muda::Menu::new();
        let items = template
            .get("items")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| super::invalid_argument("template.items", "must be an array"))?;
        for item in items {
            let submenu = build_submenu(item, window_id, bindings)?;
            menu.append(&submenu).map_err(menu_error)?;
        }
        Ok(menu)
    }

    fn build_submenu(
        value: &serde_json::Value,
        window_id: Option<&str>,
        bindings: &mut Vec<(String, crate::window::MenuCommandBinding)>,
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
                    let item_id = field_string(item, "id")?;
                    let command_id = item
                        .get("commandId")
                        .map(|_| field_string(item, "commandId"))
                        .transpose()?;
                    let native_id = if command_id.is_some() {
                        crate::window::next_menu_native_item_id("item")
                    } else {
                        item_id.clone()
                    };
                    let enabled = item
                        .get("enabled")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(true);
                    let menu_item = muda::MenuItem::with_id(
                        native_id.clone(),
                        field_string(item, "label")?,
                        enabled,
                        None,
                    );
                    submenu.append(&menu_item).map_err(menu_error)?;
                    if let Some(command_id) = command_id {
                        bindings.push((
                            native_id,
                            crate::window::MenuCommandBinding::new(
                                item_id,
                                command_id,
                                window_id.map(ToOwned::to_owned),
                            ),
                        ));
                    }
                }
                "separator" => {
                    let separator = muda::PredefinedMenuItem::separator();
                    submenu.append(&separator).map_err(menu_error)?;
                }
                "submenu" => {
                    let nested = build_submenu(item, window_id, bindings)?;
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
    use super::{HostProtocolError, MacosScreenWorkArea, MacosWindowPolish};
    use tao::{monitor::MonitorHandle, window::Window, window::WindowBuilder};

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

    pub(super) fn set_traffic_lights(
        _window: &Window,
        _traffic_lights: super::MacosTrafficLights,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "traffic-light placement is only supported on macOS",
            host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
        ))
    }

    pub(super) fn set_vibrancy(
        _window: &Window,
        _material: super::MacosVibrancyMaterial,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "window vibrancy is only supported on macOS",
            host_protocol::WINDOW_SET_VIBRANCY_METHOD,
        ))
    }

    pub(super) fn clear_vibrancy(_window: &Window) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "window vibrancy is only supported on macOS",
            host_protocol::WINDOW_CLEAR_VIBRANCY_METHOD,
        ))
    }

    pub(super) fn set_shadow(
        _window: &Window,
        _has_shadow: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "window shadow control is only supported on macOS",
            host_protocol::WINDOW_SET_SHADOW_METHOD,
        ))
    }

    pub(super) fn set_title_bar_style(
        _window: &Window,
        _title_bar_style: host_protocol::WindowTitleBarStyle,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "titlebar-style-macos-only",
            host_protocol::WINDOW_SET_TITLE_BAR_STYLE_METHOD,
        ))
    }

    pub(super) fn set_title_bar_transparent(
        _window: &Window,
        _title_bar_transparent: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "titlebar-transparency-macos-only",
            host_protocol::WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
        ))
    }

    pub(super) fn set_transparent(
        _window: &Window,
        _transparent: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "window transparency is only supported on macOS",
            host_protocol::WINDOW_SET_TRANSPARENT_METHOD,
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

    pub(super) fn set_window_menu(
        _window_id: &str,
        _template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "window menus are macOS-only in the host adapter",
            host_protocol::MENU_SET_WINDOW_MENU_METHOD,
        ))
    }

    pub(super) fn screen_work_area(_monitor: &MonitorHandle) -> Option<MacosScreenWorkArea> {
        None
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

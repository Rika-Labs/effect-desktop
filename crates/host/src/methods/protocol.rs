#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::assets;
use host_protocol::{
    HostProtocolError, ProtocolDenyPayload, ProtocolRegisterAppProtocolPayload,
    ProtocolServeAssetPayload, ProtocolServeRoutePayload,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const RESERVED_SCHEMES: &[&str] = &[
    "about",
    "app",
    "blob",
    "data",
    "file",
    "http",
    "https",
    "javascript",
    "chrome",
    "view-source",
];

pub(crate) enum ProtocolResponse {
    Asset {
        bytes: Vec<u8>,
        content_type: &'static str,
    },
    Denied,
    NotFound,
}

pub(crate) fn registered_schemes() -> Vec<String> {
    registry()
        .lock()
        .expect("protocol registry mutex should not be poisoned")
        .schemes
        .iter()
        .cloned()
        .collect()
}

pub(crate) fn resolve_custom_protocol_request(scheme: &str, raw_path: &str) -> ProtocolResponse {
    let Ok(decoded_path) = decode_request_path(raw_path) else {
        return ProtocolResponse::Denied;
    };
    if validate_url_path(&decoded_path, "path", "Protocol.request").is_err() {
        return ProtocolResponse::Denied;
    }

    let registry = registry()
        .lock()
        .expect("protocol registry mutex should not be poisoned");
    if !registry.schemes.contains(scheme) {
        return ProtocolResponse::NotFound;
    }
    if registry.is_denied(scheme, &decoded_path) {
        return ProtocolResponse::Denied;
    }
    if registry.is_route(scheme, &decoded_path) {
        return assets::resolve("/")
            .map(|asset| ProtocolResponse::Asset {
                bytes: asset.bytes,
                content_type: asset.content_type,
            })
            .unwrap_or(ProtocolResponse::NotFound);
    }
    let Some(root) = registry.asset_roots.get(scheme) else {
        return ProtocolResponse::NotFound;
    };
    let relative = decoded_path.trim_start_matches('/');
    let relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };
    let candidate = root.join(relative);
    if !candidate.starts_with(root) {
        return ProtocolResponse::Denied;
    }
    let Ok(canonical_candidate) = std::fs::canonicalize(&candidate) else {
        return ProtocolResponse::NotFound;
    };
    if !canonical_candidate.starts_with(root) {
        return ProtocolResponse::Denied;
    }
    match std::fs::read(&canonical_candidate) {
        Ok(bytes) => ProtocolResponse::Asset {
            bytes,
            content_type: content_type_for_path(&canonical_candidate),
        },
        Err(_) => ProtocolResponse::NotFound,
    }
}

pub(crate) fn register_app_protocol(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input: ProtocolRegisterAppProtocolPayload = decode_payload(
        payload,
        host_protocol::PROTOCOL_REGISTER_APP_PROTOCOL_METHOD,
    )?;
    validate_scheme(
        input.scheme(),
        host_protocol::PROTOCOL_REGISTER_APP_PROTOCOL_METHOD,
    )?;
    registry()
        .lock()
        .expect("protocol registry mutex should not be poisoned")
        .register_scheme(input.scheme());
    Ok(None)
}

pub(crate) fn serve_asset(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input: ProtocolServeAssetPayload =
        decode_payload(payload, host_protocol::PROTOCOL_SERVE_ASSET_METHOD)?;
    validate_scheme(input.scheme(), host_protocol::PROTOCOL_SERVE_ASSET_METHOD)?;
    let root = validate_local_root(input.root(), host_protocol::PROTOCOL_SERVE_ASSET_METHOD)?;
    registry()
        .lock()
        .expect("protocol registry mutex should not be poisoned")
        .serve_asset(input.scheme(), root);
    Ok(None)
}

pub(crate) fn serve_route(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input: ProtocolServeRoutePayload =
        decode_payload(payload, host_protocol::PROTOCOL_SERVE_ROUTE_METHOD)?;
    validate_scheme(input.scheme(), host_protocol::PROTOCOL_SERVE_ROUTE_METHOD)?;
    validate_url_path(
        input.route(),
        "route",
        host_protocol::PROTOCOL_SERVE_ROUTE_METHOD,
    )?;
    registry()
        .lock()
        .expect("protocol registry mutex should not be poisoned")
        .serve_route(input.scheme(), input.route());
    Ok(None)
}

pub(crate) fn deny(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input: ProtocolDenyPayload = decode_payload(payload, host_protocol::PROTOCOL_DENY_METHOD)?;
    validate_scheme(input.scheme(), host_protocol::PROTOCOL_DENY_METHOD)?;
    validate_url_path(input.path(), "path", host_protocol::PROTOCOL_DENY_METHOD)?;
    registry()
        .lock()
        .expect("protocol registry mutex should not be poisoned")
        .deny(input.scheme(), input.path());
    Ok(None)
}

fn decode_payload<A: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<A, HostProtocolError> {
    let Some(payload) = payload else {
        return Err(HostProtocolError::invalid_argument(
            "payload",
            "is required",
            operation,
        ));
    };
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn validate_scheme(scheme: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if scheme.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must be non-empty",
            operation,
        ));
    }
    let mut chars = scheme.chars();
    let Some(first) = chars.next() else {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must be non-empty",
            operation,
        ));
    };
    if !first.is_ascii_lowercase()
        || !chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || "+.-".contains(ch))
    {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "must match ^[a-z][a-z0-9+.-]*$",
            operation,
        ));
    }
    if RESERVED_SCHEMES.contains(&scheme) {
        return Err(HostProtocolError::invalid_argument(
            "scheme",
            "is reserved",
            operation,
        ));
    }
    Ok(())
}

fn validate_local_root(root: &str, operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if root.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "root",
            "must be a non-empty absolute local path",
            operation,
        ));
    }
    if has_control_character(root) {
        return Err(HostProtocolError::invalid_argument(
            "root",
            "must not contain control characters",
            operation,
        ));
    }
    let path = Path::new(root);
    if !path.is_absolute() {
        return Err(HostProtocolError::invalid_argument(
            "root",
            "must be an absolute local path",
            operation,
        ));
    }
    if is_filesystem_root(path) {
        return Err(HostProtocolError::invalid_argument(
            "root",
            "must name a scoped directory, not a filesystem root",
            operation,
        ));
    }
    if path.components().any(|component| {
        matches!(component, Component::ParentDir | Component::CurDir)
            || (cfg!(not(target_os = "windows")) && matches!(component, Component::Prefix(_)))
    }) {
        return Err(HostProtocolError::invalid_argument(
            "root",
            "must not contain traversal components",
            operation,
        ));
    }
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        HostProtocolError::invalid_argument(
            "root",
            format!("must resolve to an existing directory: {error}"),
            operation,
        )
    })?;
    if !canonical.is_dir() {
        return Err(HostProtocolError::invalid_argument(
            "root",
            "must resolve to an existing directory",
            operation,
        ));
    }
    Ok(canonical)
}

fn is_filesystem_root(path: &Path) -> bool {
    let mut components = path.components();
    match components.next() {
        Some(Component::RootDir) => components.next().is_none(),
        Some(Component::Prefix(_)) => {
            matches!(components.next(), Some(Component::RootDir)) && components.next().is_none()
        }
        _ => false,
    }
}

fn validate_url_path(
    path: &str,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !path.starts_with('/') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must start with /",
            operation,
        ));
    }
    let decoded = decode_request_path(path)
        .map_err(|reason| HostProtocolError::invalid_argument(field, reason, operation))?;
    if has_control_character(&decoded) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain control characters",
            operation,
        ));
    }
    if decoded.contains('\\') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain backslashes",
            operation,
        ));
    }
    if decoded
        .split('/')
        .any(|segment| segment == ".." || segment == ".")
    {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain traversal segments",
            operation,
        ));
    }
    Ok(())
}

fn decode_request_path(path: &str) -> Result<String, &'static str> {
    let bytes = path.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("must not contain malformed percent escapes");
            }
            let high =
                hex_value(bytes[index + 1]).ok_or("must not contain malformed percent escapes")?;
            let low =
                hex_value(bytes[index + 2]).ok_or("must not contain malformed percent escapes")?;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).map_err(|_| "must contain valid UTF-8")
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn has_control_character(value: &str) -> bool {
    value
        .chars()
        .any(|ch| matches!(ch, '\u{0000}'..='\u{001f}' | '\u{007f}'))
}

fn registry() -> &'static Mutex<ProtocolRegistry> {
    static REGISTRY: OnceLock<Mutex<ProtocolRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(ProtocolRegistry::default()))
}

#[derive(Debug, Default)]
struct ProtocolRegistry {
    schemes: BTreeSet<String>,
    asset_roots: BTreeMap<String, PathBuf>,
    routes: BTreeMap<String, BTreeSet<String>>,
    denied_paths: BTreeMap<String, BTreeSet<String>>,
}

impl ProtocolRegistry {
    fn register_scheme(&mut self, scheme: &str) {
        self.schemes.insert(scheme.to_string());
    }

    fn serve_asset(&mut self, scheme: &str, root: PathBuf) {
        self.register_scheme(scheme);
        self.asset_roots.insert(scheme.to_string(), root);
    }

    fn serve_route(&mut self, scheme: &str, route: &str) {
        self.register_scheme(scheme);
        self.routes
            .entry(scheme.to_string())
            .or_default()
            .insert(route.to_string());
    }

    fn deny(&mut self, scheme: &str, path: &str) {
        self.register_scheme(scheme);
        let path = normalized_policy_path(path);
        self.denied_paths
            .entry(scheme.to_string())
            .or_default()
            .insert(path);
    }

    fn is_route(&self, scheme: &str, path: &str) -> bool {
        self.routes
            .get(scheme)
            .is_some_and(|routes| routes.contains(path))
    }

    fn is_denied(&self, scheme: &str, path: &str) -> bool {
        self.denied_paths.get(scheme).is_some_and(|paths| {
            paths.iter().any(|denied| {
                path == denied
                    || path
                        .strip_prefix(denied)
                        .is_some_and(|rest| rest.starts_with('/'))
            })
        })
    }
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn normalized_policy_path(path: &str) -> String {
    if path == "/" {
        return path.to_string();
    }
    path.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::{deny, register_app_protocol, serve_asset, serve_route};

    #[test]
    fn protocol_methods_accept_scoped_policy_payloads() {
        let asset_root = std::env::temp_dir()
            .join("effect-desktop-protocol-test")
            .to_str()
            .expect("temp path should be valid UTF-8")
            .to_string();
        std::fs::create_dir_all(&asset_root).expect("asset root should exist");

        assert_eq!(
            register_app_protocol(Some(serde_json::json!({ "scheme": "myapp" })))
                .expect("register app protocol should succeed"),
            None
        );
        assert_eq!(
            serve_asset(Some(serde_json::json!({
                "scheme": "assets",
                "root": asset_root
            })))
            .expect("serve asset should succeed"),
            None
        );
        assert_eq!(
            serve_route(Some(serde_json::json!({
                "scheme": "myapp",
                "route": "/settings"
            })))
            .expect("serve route should succeed"),
            None
        );
        assert_eq!(
            deny(Some(serde_json::json!({
                "scheme": "assets",
                "path": "/private"
            })))
            .expect("deny should succeed"),
            None
        );
    }

    #[test]
    fn protocol_methods_reject_reserved_schemes_and_unsafe_paths() {
        assert!(serve_asset(Some(serde_json::json!({
            "scheme": "app",
            "root": "/app/assets"
        })))
        .is_err());
        assert!(serve_asset(Some(serde_json::json!({
            "scheme": "assets",
            "root": "../assets"
        })))
        .is_err());
        assert!(serve_asset(Some(serde_json::json!({
            "scheme": "assets",
            "root": "/"
        })))
        .is_err());
        assert!(serve_route(Some(serde_json::json!({
            "scheme": "myapp",
            "route": "/../secret"
        })))
        .is_err());
        assert!(serve_route(Some(serde_json::json!({
            "scheme": "myapp",
            "route": "/%2e%2e/secret"
        })))
        .is_err());
        assert!(serve_route(Some(serde_json::json!({
            "scheme": "myapp",
            "route": "/%5c..%5csecret"
        })))
        .is_err());
        assert!(deny(Some(serde_json::json!({
            "scheme": "assets",
            "path": "/private\nsecret"
        })))
        .is_err());
    }

    #[test]
    fn protocol_methods_reject_malformed_payloads() {
        assert!(register_app_protocol(None).is_err());
        assert!(register_app_protocol(Some(serde_json::json!({
            "scheme": "myapp",
            "extra": true
        })))
        .is_err());
    }
}

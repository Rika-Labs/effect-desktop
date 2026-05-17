#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    ExtensionPackageActorPayload, ExtensionPackageInstallPayload, ExtensionPackageManifestPayload,
    ExtensionPackageRemovePayload, ExtensionPackageSourcePayload, ExtensionPackageSupportedPayload,
    ExtensionPackageUpdatePayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::collections::BTreeSet;

const SHA256_PREFIX: &str = "sha256:";

pub(crate) fn install(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExtensionPackageInstallPayload>(
        payload,
        host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
    )?;
    validate_install(&input, host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD)?;
    Err(unsupported(host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD))
}

pub(crate) fn update(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExtensionPackageUpdatePayload>(
        payload,
        host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD,
    )?;
    validate_update(&input, host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD)?;
    Err(unsupported(host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD))
}

pub(crate) fn remove(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExtensionPackageRemovePayload>(
        payload,
        host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD,
    )?;
    validate_remove(&input, host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD)?;
    Err(unsupported(host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD))
}

pub(crate) fn list() -> Result<Option<Value>, HostProtocolError> {
    Err(unsupported(host_protocol::EXTENSION_PACKAGE_LIST_METHOD))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ExtensionPackageSupportedPayload::unsupported(
            host_protocol::EXTENSION_PACKAGE_UNSUPPORTED_REASON,
        ),
        host_protocol::EXTENSION_PACKAGE_IS_SUPPORTED_METHOD,
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
            format!("failed to encode extension package payload: {error}"),
            operation,
        )
    })
}

fn validate_install(
    input: &ExtensionPackageInstallPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_source(input.source(), operation)?;
    validate_manifest(input.manifest(), operation)
}

fn validate_update(
    input: &ExtensionPackageUpdatePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_source(input.source(), operation)?;
    validate_manifest(input.manifest(), operation)?;
    if let Some(expected_version) = input.expected_version() {
        validate_version("expectedVersion", expected_version, operation)?;
    }
    Ok(())
}

fn validate_remove(
    input: &ExtensionPackageRemovePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_name("packageId", input.package_id(), operation)
}

fn validate_actor(
    actor: &ExtensionPackageActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_name("actor.id", actor.id(), operation)
}

fn validate_source(
    source: &ExtensionPackageSourcePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if source.uri().trim() != source.uri() {
        return Err(HostProtocolError::invalid_argument(
            "source.uri",
            "must not include leading or trailing whitespace",
            operation,
        ));
    }
    if let Some(digest) = source.digest() {
        validate_sha256_digest("source.digest", digest, operation)?;
    }
    Ok(())
}

fn validate_manifest(
    manifest: &ExtensionPackageManifestPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_name("manifest.id", manifest.id(), operation)?;
    validate_version("manifest.version", manifest.version(), operation)?;
    validate_entrypoint(manifest.entrypoint(), operation)?;
    if manifest.capabilities().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.capabilities",
            "must declare at least one capability",
            operation,
        ));
    }
    let mut capabilities = BTreeSet::new();
    for declaration in manifest.capabilities() {
        validate_capability(declaration.capability(), operation)?;
        let key = serde_json::to_string(declaration.capability()).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to canonicalize extension package capability: {error}"),
                operation,
            )
        })?;
        if !capabilities.insert(key) {
            return Err(HostProtocolError::invalid_argument(
                "manifest.capabilities",
                "must be unique",
                operation,
            ));
        }
    }
    if let Some(min_host_version) = manifest.compatibility().min_host_version() {
        validate_version(
            "manifest.compatibility.minHostVersion",
            min_host_version,
            operation,
        )?;
    }
    if let Some(max_host_version) = manifest.compatibility().max_host_version() {
        validate_version(
            "manifest.compatibility.maxHostVersion",
            max_host_version,
            operation,
        )?;
    }
    if let (Some(min_host_version), Some(max_host_version)) = (
        manifest.compatibility().min_host_version(),
        manifest.compatibility().max_host_version(),
    ) {
        if compare_semver(min_host_version, max_host_version) > 0 {
            return Err(HostProtocolError::invalid_argument(
                "manifest.compatibility",
                "minHostVersion must be less than or equal to maxHostVersion",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_capability(
    capability: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(kind) = capability.get("kind").and_then(Value::as_str) else {
        return Err(HostProtocolError::invalid_argument(
            "manifest.capabilities.capability.kind",
            "must be a string",
            operation,
        ));
    };
    if kind.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.capabilities.capability.kind",
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_entrypoint(entrypoint: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if entrypoint.starts_with('/') || entrypoint.contains('\\') || entrypoint.contains("://") {
        return Err(HostProtocolError::invalid_argument(
            "manifest.entrypoint",
            "must be a relative package path",
            operation,
        ));
    }
    if entrypoint
        .split('/')
        .any(|part| part.is_empty() || matches!(part, "." | ".."))
    {
        return Err(HostProtocolError::invalid_argument(
            "manifest.entrypoint",
            "must stay inside the package",
            operation,
        ));
    }
    Ok(())
}

fn validate_name(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    if !value
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must contain only letters, numbers, dots, underscores, or dashes",
            operation,
        ));
    }
    Ok(())
}

fn validate_version(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !valid_semver(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be SemVer",
            operation,
        ));
    }
    Ok(())
}

fn valid_semver(value: &str) -> bool {
    let mut build_split = value.splitn(2, '+');
    let release = build_split.next().unwrap_or_default();
    let build = build_split.next();
    if build.is_some_and(|value| !valid_build_metadata(value)) {
        return false;
    }
    let mut prerelease_split = release.splitn(2, '-');
    let core = prerelease_split.next().unwrap_or_default();
    let prerelease = prerelease_split.next();
    valid_semver_core(core) && prerelease.is_none_or(valid_prerelease)
}

fn valid_semver_core(core: &str) -> bool {
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| valid_semver_number(part))
}

fn valid_semver_number(part: &str) -> bool {
    if part.is_empty() || !part.chars().all(|value| value.is_ascii_digit()) {
        return false;
    }
    part == "0" || !part.starts_with('0')
}

fn valid_prerelease(value: &str) -> bool {
    valid_dot_identifiers(value, |identifier| {
        valid_semver_identifier(identifier)
            && (!is_numeric(identifier) || valid_semver_number(identifier))
    })
}

fn valid_build_metadata(value: &str) -> bool {
    valid_dot_identifiers(value, valid_semver_identifier)
}

fn valid_dot_identifiers(value: &str, is_valid: impl Fn(&str) -> bool) -> bool {
    !value.is_empty() && value.split('.').all(is_valid)
}

fn valid_semver_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn is_numeric(value: &str) -> bool {
    value.chars().all(|character| character.is_ascii_digit())
}

fn compare_semver(left: &str, right: &str) -> i8 {
    let left_parts = semver_numbers(left);
    let right_parts = semver_numbers(right);
    for index in 0..3 {
        match left_parts[index].cmp(&right_parts[index]) {
            std::cmp::Ordering::Less => return -1,
            std::cmp::Ordering::Greater => return 1,
            std::cmp::Ordering::Equal => {}
        }
    }
    0
}

fn semver_numbers(value: &str) -> [u64; 3] {
    let mut parts = value
        .split(['-', '+'])
        .next()
        .unwrap_or_default()
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0));
    [
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    ]
}

fn validate_sha256_digest(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let digest = value.strip_prefix(SHA256_PREFIX).ok_or_else(|| {
        HostProtocolError::invalid_argument(field, "must be a sha256 digest", operation)
    })?;
    if digest.len() == 64 && digest.chars().all(|value| value.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(HostProtocolError::invalid_argument(
            field,
            "must be a sha256 digest",
            operation,
        ))
    }
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::EXTENSION_PACKAGE_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{install, is_supported, remove, update};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn install_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = install(Some(valid_install_payload())).expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::EXTENSION_PACKAGE_UNSUPPORTED_REASON,
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
    }

    #[test]
    fn install_rejects_manifest_escape_before_unsupported() {
        let mut payload = valid_install_payload();
        payload["manifest"]["entrypoint"] = json!("../escape.js");
        let error = install(Some(payload)).expect_err("invalid entrypoint must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.entrypoint",
                "must stay inside the package",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
    }

    #[test]
    fn install_rejects_malformed_semver_before_unsupported() {
        let mut payload = valid_install_payload();
        payload["manifest"]["version"] = json!("1.0.0-");
        let error = install(Some(payload)).expect_err("invalid SemVer must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.version",
                "must be SemVer",
                host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
            )
        );
    }

    #[test]
    fn update_rejects_bad_expected_version_before_unsupported() {
        let mut payload = valid_install_payload();
        payload["expectedVersion"] = json!("01.0.0");
        let error = update(Some(payload)).expect_err("invalid expected version must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "expectedVersion",
                "must be SemVer",
                host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD,
            )
        );
    }

    #[test]
    fn remove_rejects_invalid_package_id_before_unsupported() {
        let error = remove(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "packageId": "../extension"
        })))
        .expect_err("invalid package id must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "packageId",
                "must contain only letters, numbers, dots, underscores, or dashes",
                host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD,
            )
        );
    }

    #[test]
    fn is_supported_returns_typed_unsupported_status() {
        let payload = is_supported().expect("support payload should encode");

        assert_eq!(
            payload,
            Some(json!({
                "supported": false,
                "reason": host_protocol::EXTENSION_PACKAGE_UNSUPPORTED_REASON
            }))
        );
    }

    fn valid_install_payload() -> serde_json::Value {
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "source": {
                "kind": "directory",
                "uri": "file:///tmp/extensions/extension-1",
                "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            },
            "manifest": {
                "id": "extension-1",
                "name": "Extension One",
                "version": "1.0.0",
                "entrypoint": "dist/main.js",
                "compatibility": {
                    "minHostVersion": "1.0.0",
                    "maxHostVersion": "2.0.0"
                },
                "capabilities": [
                    {
                        "capability": {
                            "kind": "filesystem.read",
                            "roots": ["/tmp/extensions"],
                            "audit": "always"
                        },
                        "reason": "read extension files"
                    }
                ]
            },
            "traceId": "trace-extension-package"
        })
    }
}

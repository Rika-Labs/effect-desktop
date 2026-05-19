#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::methods::open_intent;
use host_protocol::HostProtocolError;
use host_protocol::{
    AppMetadataEnvironmentShapePayload, AppMetadataInfoPayload, AppMetadataLaunchContextPayload,
    AppMetadataPathsPayload, CanonicalPathPayload,
};
use serde::Deserialize;
use serde_json::Value;
use std::{
    env,
    path::{Path, PathBuf},
};

const DEFAULT_APP_ID: &str = "dev.effect-desktop.host";
const DEFAULT_APP_NAME: &str = "Effect Desktop Host";
const DEFAULT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub(crate) fn get_info(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::APP_METADATA_GET_INFO_METHOD)?;
    encode_payload(
        read_manifest_metadata()?.map_or_else(
            || AppMetadataInfoPayload::new(DEFAULT_APP_ID, DEFAULT_APP_NAME, DEFAULT_APP_VERSION),
            |manifest| AppMetadataInfoPayload::new(manifest.id, manifest.name, manifest.version),
        ),
        host_protocol::APP_METADATA_GET_INFO_METHOD,
    )
}

pub(crate) fn get_paths(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::APP_METADATA_GET_PATHS_METHOD)?;
    let executable = canonical_current_exe(host_protocol::APP_METADATA_GET_PATHS_METHOD)?;
    let cwd = canonical_current_dir(host_protocol::APP_METADATA_GET_PATHS_METHOD)?;
    let resources =
        canonical_resources_path(&executable, host_protocol::APP_METADATA_GET_PATHS_METHOD)?;
    encode_payload(
        AppMetadataPathsPayload::new(
            CanonicalPathPayload::new(path_to_string(&executable)),
            CanonicalPathPayload::new(path_to_string(&resources)),
            CanonicalPathPayload::new(path_to_string(&cwd)),
        ),
        host_protocol::APP_METADATA_GET_PATHS_METHOD,
    )
}

pub(crate) fn get_launch_context(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(
        payload,
        host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD,
    )?;
    let cwd = canonical_current_dir(host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD)?;
    let argv = env::args()
        .filter(|value| !value.is_empty() && !value.contains('\0'))
        .collect::<Vec<_>>();
    let launch_reason = open_intent::app_metadata_launch_reason(&argv);
    let mut variable_names = env::vars()
        .map(|(key, _value)| key)
        .filter(|key| !key.is_empty() && !key.contains('=') && !key.contains('\0'))
        .collect::<Vec<_>>();
    variable_names.sort();
    variable_names.dedup();

    encode_payload(
        AppMetadataLaunchContextPayload::new(
            argv,
            CanonicalPathPayload::new(path_to_string(&cwd)),
            launch_reason,
            AppMetadataEnvironmentShapePayload::new(variable_names),
        ),
        host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD,
    )
}

fn reject_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        )),
    }
}

fn encode_payload<T: serde::Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(payload)
        .map(Some)
        .map_err(|error| HostProtocolError::invalid_output(operation, error.to_string()))
}

#[derive(Debug, Deserialize)]
struct AppManifestMetadata {
    id: String,
    name: String,
    version: String,
}

fn read_manifest_metadata() -> Result<Option<AppManifestMetadata>, HostProtocolError> {
    let executable = match env::current_exe() {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let Some(manifest_path) = crate::runtime::manifest_path_for_exe(&executable) else {
        return Ok(None);
    };
    if !manifest_path.is_file() {
        return Ok(None);
    }
    let source = std::fs::read_to_string(&manifest_path).map_err(|error| {
        HostProtocolError::host_unavailable(format!(
            "failed to read app metadata manifest {}: {error}",
            manifest_path.display()
        ))
    })?;
    serde_json::from_str::<AppManifestMetadata>(&source)
        .map(Some)
        .map_err(|error| {
            HostProtocolError::invalid_output(
                host_protocol::APP_METADATA_GET_INFO_METHOD,
                format!("failed to decode app metadata manifest: {error}"),
            )
        })
}

fn canonical_current_exe(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    env::current_exe()
        .and_then(|path| path.canonicalize())
        .map_err(|error| {
            HostProtocolError::host_unavailable(format!(
                "failed to resolve current executable for {operation}: {error}"
            ))
        })
}

fn canonical_current_dir(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    env::current_dir()
        .and_then(|path| path.canonicalize())
        .map_err(|error| {
            HostProtocolError::host_unavailable(format!(
                "failed to resolve current directory for {operation}: {error}"
            ))
        })
}

fn canonical_resources_path(
    executable: &Path,
    operation: &'static str,
) -> Result<PathBuf, HostProtocolError> {
    if let Some(manifest_path) = crate::runtime::manifest_path_for_exe(executable) {
        if let Some(parent) = manifest_path.parent() {
            return parent.canonicalize().map_err(|error| {
                HostProtocolError::host_unavailable(format!(
                    "failed to resolve app metadata resources path for {operation}: {error}"
                ))
            });
        }
    }

    executable
        .parent()
        .unwrap_or(executable)
        .canonicalize()
        .map_err(|error| {
            HostProtocolError::host_unavailable(format!(
                "failed to resolve app metadata resources path for {operation}: {error}"
            ))
        })
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{get_info, get_launch_context, get_paths};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn app_metadata_requests_reject_payloads_before_host_reads() {
        assert_eq!(
            get_info(Some(json!({}))).expect_err("get info rejects object payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_METADATA_GET_INFO_METHOD,
            )
        );
        assert_eq!(
            get_paths(Some(json!({ "unexpected": true })))
                .expect_err("get paths rejects object payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_METADATA_GET_PATHS_METHOD,
            )
        );
        assert_eq!(
            get_launch_context(Some(json!([]))).expect_err("launch context rejects array payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD,
            )
        );
    }

    #[test]
    fn app_metadata_requests_return_host_owned_metadata() {
        let info = get_info(None)
            .expect("get info should succeed")
            .expect("get info returns payload");
        assert!(info["id"].as_str().is_some_and(|value| !value.is_empty()));
        assert!(info["name"].as_str().is_some_and(|value| !value.is_empty()));
        assert!(info["version"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));

        let paths = get_paths(Some(json!(null)))
            .expect("get paths should succeed")
            .expect("get paths returns payload");
        assert!(paths["executable"]["path"]
            .as_str()
            .is_some_and(|path| !path.is_empty()));
        assert!(paths["resources"]["path"]
            .as_str()
            .is_some_and(|path| !path.is_empty()));
        assert!(paths["cwd"]["path"]
            .as_str()
            .is_some_and(|path| !path.is_empty()));

        let launch_context = get_launch_context(None)
            .expect("launch context should succeed")
            .expect("launch context returns payload");
        assert_eq!(launch_context["reason"], "launch");
        assert!(launch_context["environment"]["variableNames"].is_array());
        assert!(launch_context["environment"].get("values").is_none());
    }
}

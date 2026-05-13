mod generated {
    include!(concat!(env!("OUT_DIR"), "/generated_csp.rs"));
}

use serde_json::Value;
use std::{
    error::Error,
    fmt,
    path::{Path, PathBuf},
    sync::OnceLock,
};

const CSP_NONCE_PLACEHOLDER: &str = "{N}";
const APP_MANIFEST_FILE: &str = "app-manifest.json";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CspNonce(String);

impl CspNonce {
    pub(crate) fn mint() -> Self {
        Self(uuid::Uuid::new_v4().simple().to_string())
    }

    #[cfg(test)]
    pub(crate) fn fixed(value: &str) -> Self {
        Self(value.to_owned())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CspPolicy {
    directives: Vec<CspDirective>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CspDirective {
    name: String,
    values: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CspPolicyError {
    message: String,
}

impl CspPolicyError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for CspPolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for CspPolicyError {}

type CspPolicyResult = Result<CspPolicy, CspPolicyError>;

static CURRENT_POLICY: OnceLock<CspPolicyResult> = OnceLock::new();

impl From<&(&str, &[&str])> for CspDirective {
    fn from((name, values): &(&str, &[&str])) -> Self {
        Self {
            name: (*name).to_owned(),
            values: values.iter().map(|value| (*value).to_owned()).collect(),
        }
    }
}

impl CspPolicy {
    pub(crate) fn default() -> Self {
        Self {
            directives: generated::DEFAULT_CSP_DIRECTIVES
                .iter()
                .map(CspDirective::from)
                .collect(),
        }
    }

    pub(crate) fn current() -> CspPolicyResult {
        CURRENT_POLICY
            .get_or_init(Self::from_current_exe_manifest)
            .clone()
    }

    pub(crate) fn render(&self, nonce: &CspNonce) -> String {
        self.directives
            .iter()
            .map(|directive| {
                let mut parts = Vec::with_capacity(directive.values.len() + 1);
                parts.push(directive.name.clone());
                parts.extend(
                    directive
                        .values
                        .iter()
                        .map(|value| value.replace(CSP_NONCE_PLACEHOLDER, nonce.as_str())),
                );
                parts.join(" ")
            })
            .collect::<Vec<_>>()
            .join("; ")
    }

    fn from_current_exe_manifest() -> CspPolicyResult {
        let current_exe = std::env::current_exe().map_err(|error| {
            CspPolicyError::new(format!(
                "failed to resolve current executable path: {error}"
            ))
        })?;
        let Some(path) = manifest_path_for_exe(&current_exe) else {
            return Ok(Self::default());
        };
        Self::from_manifest_path(&path)
    }

    fn from_manifest_path(path: &Path) -> CspPolicyResult {
        if !path.exists() {
            return Ok(Self::default());
        }

        let source = std::fs::read_to_string(path).map_err(|error| {
            CspPolicyError::new(format!("failed to read {}: {error}", path.display()))
        })?;
        Self::from_manifest_str(&source)
    }

    pub(crate) fn from_manifest_str(source: &str) -> CspPolicyResult {
        let value: Value = serde_json::from_str(source).map_err(|error| {
            CspPolicyError::new(format!("{APP_MANIFEST_FILE} must be valid JSON: {error}"))
        })?;
        let csp = value
            .get("rendererManifest")
            .and_then(Value::as_object)
            .and_then(|renderer| renderer.get("csp"))
            .ok_or_else(|| {
                CspPolicyError::new(
                    "app-manifest.json.rendererManifest.csp must contain the serving CSP policy",
                )
            })?;
        let directives = csp
            .get("directives")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CspPolicyError::new(
                    "app-manifest.json.rendererManifest.csp.directives must be an array",
                )
            })?
            .iter()
            .enumerate()
            .map(|(index, directive)| parse_directive(index, directive))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self { directives })
    }

    #[cfg(test)]
    pub(crate) fn from_test_directives(directives: &[(&str, &[&str])]) -> Self {
        Self {
            directives: directives.iter().map(CspDirective::from).collect(),
        }
    }
}

fn parse_directive(index: usize, value: &Value) -> Result<CspDirective, CspPolicyError> {
    let name = value.get("name").and_then(Value::as_str).ok_or_else(|| {
        CspPolicyError::new(format!(
            "app-manifest.json.rendererManifest.csp.directives[{index}].name must be a string"
        ))
    })?;
    if name.is_empty() {
        return Err(CspPolicyError::new(format!(
            "app-manifest.json.rendererManifest.csp.directives[{index}].name must not be empty"
        )));
    }

    let values = value
        .get("values")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CspPolicyError::new(format!(
                "app-manifest.json.rendererManifest.csp.directives[{index}].values must be an array"
            ))
        })?
        .iter()
        .enumerate()
        .map(|(value_index, value)| {
            let value = value.as_str().ok_or_else(|| {
                CspPolicyError::new(format!(
                    "app-manifest.json.rendererManifest.csp.directives[{index}].values[{value_index}] must be a string"
                ))
            })?;
            if value.is_empty() {
                return Err(CspPolicyError::new(format!(
                    "app-manifest.json.rendererManifest.csp.directives[{index}].values[{value_index}] must not be empty"
                )));
            }
            Ok(value.to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(CspDirective {
        name: name.to_owned(),
        values,
    })
}

fn manifest_path_for_exe(exe: &Path) -> Option<PathBuf> {
    exe.parent()?
        .parent()
        .map(|layout| layout.join(APP_MANIFEST_FILE))
}

#[cfg(test)]
mod tests {
    use super::{manifest_path_for_exe, CspNonce, CspPolicy, CSP_NONCE_PLACEHOLDER};
    use std::path::Path;

    #[test]
    fn default_policy_renders_spec_directives_with_nonce() {
        let nonce = CspNonce::fixed("fixednonce");
        let policy = CspPolicy::default().render(&nonce);

        assert_eq!(
            policy,
            "default-src 'self'; script-src 'self' 'nonce-fixednonce'; style-src 'self' 'nonce-fixednonce'; style-src-attr 'unsafe-inline'; connect-src 'self' app:; img-src 'self' app: data: https:; font-src 'self' app: data:; media-src 'self' app:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'"
        );
        assert!(
            !policy.contains("script-src 'self' 'unsafe-inline'"),
            "script execution must remain nonce-only"
        );
        assert!(
            !policy.contains("style-src 'self' 'unsafe-inline'"),
            "<style> and <link rel='stylesheet'> must remain nonce-or-self only"
        );
        assert!(
            policy.contains("style-src-attr 'unsafe-inline'"),
            "inline style attributes from prerendered HTML must be permitted"
        );
        assert!(!policy.contains("unsafe-eval"));
    }

    #[test]
    fn default_policy_substitutes_nonce_without_changing_other_directives() {
        let nonce = CspNonce::fixed("fixednonce");
        let policy = CspPolicy::default().render(&nonce);

        assert!(policy.contains("script-src 'self' 'nonce-fixednonce'"));
        assert!(!policy.contains(CSP_NONCE_PLACEHOLDER));
    }

    #[test]
    fn manifest_policy_overrides_default_directives() {
        let policy = CspPolicy::from_manifest_str(
            r#"{
              "rendererManifest": {
                "csp": {
                  "directives": [
                    { "name": "default-src", "values": ["'self'"] },
                    { "name": "connect-src", "values": ["'self'", "https:"] },
                    { "name": "upgrade-insecure-requests", "values": [] }
                  ]
                }
              }
            }"#,
        )
        .expect("manifest policy should parse");

        assert_eq!(
            policy.render(&CspNonce::fixed("fixednonce")),
            "default-src 'self'; connect-src 'self' https:; upgrade-insecure-requests"
        );
    }

    #[test]
    fn manifest_policy_accepts_disabled_empty_directives() {
        let policy = CspPolicy::from_manifest_str(
            r#"{
              "rendererManifest": {
                "csp": {
                  "directives": []
                }
              }
            }"#,
        )
        .expect("disabled manifest policy should parse");

        assert_eq!(policy.render(&CspNonce::fixed("fixednonce")), "");
    }

    #[test]
    fn manifest_policy_requires_renderer_csp() {
        let error = CspPolicy::from_manifest_str(r#"{"rendererManifest":{}}"#)
            .expect_err("missing renderer CSP should fail");

        assert!(
            error.to_string().contains("rendererManifest.csp"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn manifest_path_points_from_native_binary_to_layout_manifest() {
        let path = manifest_path_for_exe(Path::new("/app/layout/native/host"))
            .expect("manifest path should resolve");

        assert_eq!(path, Path::new("/app/layout/app-manifest.json"));
    }
}

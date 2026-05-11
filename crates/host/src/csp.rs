use std::env;

const APP_CSP_TEMPLATE_ENV: &str = "EFFECT_DESKTOP_CSP_TEMPLATE";
const APP_CSP_TEMPLATE: &str = "default-src 'self'; script-src 'self' 'nonce-{N}'; style-src 'self' 'nonce-{N}'; style-src-attr 'unsafe-inline'; connect-src 'self' app:; img-src 'self' app: data: https:; font-src 'self' app: data:; media-src 'self' app:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'";

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
    rendered: String,
}

impl CspPolicy {
    pub(crate) fn default_for_nonce(nonce: &CspNonce) -> Self {
        Self::from_template(APP_CSP_TEMPLATE, nonce)
    }

    pub(crate) fn from_template(template: &str, nonce: &CspNonce) -> Self {
        Self {
            rendered: template.replace("{N}", nonce.as_str()),
        }
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.rendered
    }
}

pub(crate) fn configured_template() -> Option<String> {
    env::var(APP_CSP_TEMPLATE_ENV)
        .ok()
        .filter(|template| !template.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::{configured_template, CspNonce, CspPolicy, APP_CSP_TEMPLATE_ENV};

    #[test]
    fn default_policy_renders_spec_directives_with_nonce() {
        let nonce = CspNonce::fixed("fixednonce");
        let policy = CspPolicy::default_for_nonce(&nonce);

        assert_eq!(
            policy.as_str(),
            "default-src 'self'; script-src 'self' 'nonce-fixednonce'; style-src 'self' 'nonce-fixednonce'; style-src-attr 'unsafe-inline'; connect-src 'self' app:; img-src 'self' app: data: https:; font-src 'self' app: data:; media-src 'self' app:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'"
        );
        assert!(
            !policy
                .as_str()
                .contains("script-src 'self' 'unsafe-inline'"),
            "script execution must remain nonce-only"
        );
        assert!(
            !policy.as_str().contains("style-src 'self' 'unsafe-inline'"),
            "<style> and <link rel='stylesheet'> must remain nonce-or-self only"
        );
        assert!(
            policy.as_str().contains("style-src-attr 'unsafe-inline'"),
            "inline style attributes from prerendered HTML must be permitted"
        );
        assert!(!policy.as_str().contains("unsafe-eval"));
    }

    #[test]
    fn template_policy_substitutes_nonce_without_changing_other_directives() {
        let nonce = CspNonce::fixed("fixednonce");
        let policy = CspPolicy::from_template(
            "default-src 'self'; connect-src 'self'; script-src 'nonce-{N}'",
            &nonce,
        );

        assert_eq!(
            policy.as_str(),
            "default-src 'self'; connect-src 'self'; script-src 'nonce-fixednonce'"
        );
    }

    #[test]
    fn configured_template_ignores_missing_or_empty_env_values() {
        let previous = std::env::var(APP_CSP_TEMPLATE_ENV).ok();
        std::env::remove_var(APP_CSP_TEMPLATE_ENV);
        assert_eq!(configured_template(), None);

        std::env::set_var(APP_CSP_TEMPLATE_ENV, "   ");
        assert_eq!(configured_template(), None);

        if let Some(previous) = previous {
            std::env::set_var(APP_CSP_TEMPLATE_ENV, previous);
        } else {
            std::env::remove_var(APP_CSP_TEMPLATE_ENV);
        }
    }
}

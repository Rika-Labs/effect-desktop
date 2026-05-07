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
        Self {
            rendered: APP_CSP_TEMPLATE.replace("{N}", nonce.as_str()),
        }
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.rendered
    }
}

#[cfg(test)]
mod tests {
    use super::{CspNonce, CspPolicy};

    #[test]
    fn default_policy_renders_spec_directives_with_nonce() {
        let nonce = CspNonce::fixed("fixednonce");
        let policy = CspPolicy::default_for_nonce(&nonce);

        assert_eq!(
            policy.as_str(),
            "default-src 'self'; script-src 'self' 'nonce-fixednonce'; style-src 'self' 'nonce-fixednonce'; style-src-attr 'unsafe-inline'; connect-src 'self' app:; img-src 'self' app: data: https:; font-src 'self' app: data:; media-src 'self' app:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'"
        );
        assert!(
            !policy.as_str().contains("script-src 'self' 'unsafe-inline'"),
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
}

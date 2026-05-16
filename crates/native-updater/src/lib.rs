pub mod audit;
pub mod manifest;
pub mod policy;
pub mod restart;
pub mod staging;

pub use audit::{UpdateAuditEvent, UpdateAuditRow};
pub use manifest::{
    canonical_manifest_bytes, verify_manifest, TrustAnchor, UpdateArtifact, UpdateArtifactKind,
    UpdateChannel, UpdateManifest, UpdateManifestError, UpdatePlatform, VerifiedManifest,
    TRUST_WINDOW,
};
pub use policy::{
    evaluate_update, resolve_feed_url, UpdateCheckError, UpdateDecision, UpdatePolicy,
    UpdatePolicyRejection, VersionSource,
};
pub use restart::{
    prepare_restart, ready_for_restart, record_restart_breadcrumb, PreparingRestart,
    RestartBreadcrumb, RestartReadiness, RESTART_DEADLINE_MS,
};
pub use staging::{
    cleanup_stale_temp_dir, commit_staged_install, stage_install, validate_notarization,
    InstallPaths, InstallPlan, InstallStagingError, PreparedInstall, RollbackMetadata,
    STALE_NOTARIZATION_MS,
};

#[cfg(test)]
mod tests;

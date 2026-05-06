# Signed Update Policy Needs Audience Binding

## Observation

The first channel-routing policy accepted any verified manifest whose channel and version matched the configured policy. Review caught that a trusted signature alone does not prove the manifest is for the installed app.

## Evidence

- PR #264 review: `Add app-id match check before accepting manifest`.
- Fixed in `crates/native-updater/src/lib.rs` by adding `UpdatePolicy.app_id`, `UpdateCheckError::AppIdMismatch`, and `UpdateAuditEvent::AppIdMismatch`.
- Verified by `native-updater::policy_rejects_manifest_for_a_different_app_id`.
- CI passed on `blacksmith-2vcpu-ubuntu-2404`, `blacksmith-6vcpu-macos-latest`, and `blacksmith-2vcpu-windows-2025`.

## General Principle

A signature proves who signed bytes; it does not prove the bytes are intended for this audience. Any signed artifact policy must bind the signed metadata to the configured app, tenant, channel, or other audience identity before it can be accepted.

## Trigger Condition

Apply this whenever verified signed metadata is reused across apps, tenants, channels, feeds, package targets, or install contexts.

## Limits / Counterexamples

This does not require every verifier to know every runtime policy field. It does require the acceptance gate after verification to compare the signed audience identifier with the configured audience identifier before returning success.

## Codification Target

- docs/learnings

## Proposed Amendment Or Issue

When adding signed-artifact policy checks, include an explicit audience-binding test beside signature, freshness, and downgrade tests.

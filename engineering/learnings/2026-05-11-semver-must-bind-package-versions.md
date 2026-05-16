# Semver must bind package versions

## Context

The semver gate validated release policy and public API snapshots but did not read package manifests. That allowed a release manifest to claim `1.1.0` while every first-party package still advertised `0.0.0`.

## Change

The semver guard now reads `packages/*/package.json`, requires each package version to match `release/semver.json#release`, and reports mismatched package names and versions as a typed manifest error. The repository release metadata and first-party package versions are now aligned to `2.0.0`, matching the current public API diff as a major release.

## Lesson

Release version checks must bind the release manifest to publishable package metadata. A semver gate that ignores package manifests can certify a release that cannot be published consistently.

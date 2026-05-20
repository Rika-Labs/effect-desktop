---
title: AppMetadata (native)
description: App identity, paths, launch context, and environment-shape boundary.
kind: reference
audience: app-developers
effect_version: 4
---

# `AppMetadata`

Declare app identity, executable/resource paths, launch context, and
environment shape through the native host boundary.

The Rust host adapter reads packaged `app-manifest.json` identity when present,
falls back to host package metadata in source/dev runs, and returns runtime
paths and launch context from the host process.

## Status

| Method             | Success                    | Runtime support |
| ------------------ | -------------------------- | --------------- |
| `getInfo`          | `AppMetadataInfo`          | supported       |
| `getPaths`         | `AppMetadataPaths`         | supported       |
| `getLaunchContext` | `AppMetadataLaunchContext` | supported       |

## Contracts

`AppMetadataInfo` contains `id`, `name`, and semver `version`, including
optional prerelease and build metadata.

`AppMetadataPaths` contains canonical `executable`, `resources`, and `cwd`
paths.

`AppMetadataLaunchContext` contains `argv`, canonical `cwd`, launch `reason`,
and `environment`. The environment contract exposes only variable names through
`AppMetadataEnvironmentShape.variableNames`; it does not expose environment
values.

Launch reasons are `launch`, `open-file`, `open-url`, and `unknown`. The Rust
host classifies `reason` from argv as `open-file` when exactly one safe absolute
file path is present, `open-url` when exactly one safe non-dangerous URL is
present, `unknown` when intent-like argv is unsafe or ambiguous, and `launch`
otherwise. This does not emit native open-file/open-url events by itself.

## Events

The current event stream is `events()`. Event phases are `info-read`,
`paths-read`, `launch-context-read`, and `failed`. Native event delivery is
reserved for future metadata refresh events.

## Errors

`AppMetadataError` is the host protocol error union. AppMetadata methods decode
through Rust `AppMetadata.*` routes and fail as typed host protocol errors when
host-owned metadata or canonical paths cannot be read.

## Related

- Reference: [`App`](app.md), [`Path`](path.md)
- Source: [`packages/native/src/app-metadata.ts`](../../../packages/native/src/app-metadata.ts)

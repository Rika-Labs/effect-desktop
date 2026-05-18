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

The TypeScript surface is present for contract and bridge-client validation
work, but the Rust host AppMetadata adapter is not implemented. The native
surface reports `unsupported` on macOS, Windows, and Linux until the host owns
package/config/runtime metadata collection.

## Status

| Method             | Success                    | Runtime support |
| ------------------ | -------------------------- | --------------- |
| `getInfo`          | `AppMetadataInfo`          | unsupported     |
| `getPaths`         | `AppMetadataPaths`         | unsupported     |
| `getLaunchContext` | `AppMetadataLaunchContext` | unsupported     |

## Contracts

`AppMetadataInfo` contains `id`, `name`, and semver `version`, including
optional prerelease and build metadata.

`AppMetadataPaths` contains canonical `executable`, `resources`, and `cwd`
paths.

`AppMetadataLaunchContext` contains `argv`, canonical `cwd`, launch `reason`,
and `environment`. The environment contract exposes only variable names through
`AppMetadataEnvironmentShape.variableNames`; it does not expose environment
values.

Launch reasons are `launch`, `open-file`, `open-url`, and `unknown`.

## Events

The current event stream is `events()`. Event phases are `info-read`,
`paths-read`, `launch-context-read`, and `failed`. Native event delivery is
currently unsupported until the host adapter exists.

## Errors

`AppMetadataError` is the host protocol error union. Until the host adapter is
implemented, AppMetadata methods decode through Rust `AppMetadata.*` routes and
fail closed as typed `Unsupported` with reason
`host-adapter-unimplemented`.

## Related

- Reference: [`App`](app.md), [`Path`](path.md)
- Source: [`packages/native/src/app-metadata.ts`](../../../packages/native/src/app-metadata.ts)

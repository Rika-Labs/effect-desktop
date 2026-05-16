# Contain renderer dist path

## Context

`desktop build` resolved `renderer.dist` relative to the app root but did not verify that the result stayed inside that root. A config could point at `../../outside-dist`, run the build, and stage files owned by a parent directory.

## Change

The build plan now validates `renderer.dist` as a relative app-owned path during config normalization. Absolute paths and parent-directory escapes fail with `BuildConfigError` before renderer, runtime, or native build steps run.

## Lesson

Build inputs are a trust boundary. Resolve user paths once, validate containment at the boundary, and carry only the validated path through later staging steps.

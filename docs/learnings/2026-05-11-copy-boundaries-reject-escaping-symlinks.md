# Copy boundaries reject escaping symlinks

## Context

Build and package staging used recursive copies based on `stat`, which follows symlinks. A renderer output or existing build layout could contain a symlink to a file outside the trusted root and silently copy those external bytes into release artifacts.

## Change

The build renderer copier and package layout copier now use link-aware traversal. Each symlink is resolved relative to its link location and rejected if the target leaves the original copy root. Escaping links fail with typed build/package file errors before external bytes are staged or package tools run.

## Lesson

Recursive copy is a trust boundary in release tooling. Use metadata that does not follow links first, validate the resolved target against the boundary, and only then copy bytes.

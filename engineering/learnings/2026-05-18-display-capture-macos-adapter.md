---
title: DisplayCapture macOS host adapter
date: 2026-05-18
issue: 1411
---

# DisplayCapture macOS Host Adapter

## What Changed

`DisplayCapture.captureDisplay`, `captureWindow`, and `captureRegion` now have a production macOS host path. The Rust host validates the decoded payload, builds `/usr/sbin/screencapture` arguments without a shell, reads the PNG output, validates the PNG header, and returns the existing `{ image, metadata }` contract.

## Why

The broker already had the right TypeScript boundary: Schema validation, grant verification, native permission checks, redacted audit rows, typed image validation, and substitutable clients. The missing piece was real host capture behavior. Using the macOS system tool keeps Screen Recording consent in the OS path instead of inventing a local bypass.

## Verification

The tests use a fake command runner for deterministic PNG output and argument assertions. That verifies the host contract without prompting CI for Screen Recording permission. Manual host behavior still depends on macOS granting capture permission to the running app.

## Architecture-Debt Sweep

Touched area: DisplayCapture native support metadata, Rust host display-capture route, host protocol payload constructors, generated parity data, and reference docs.

No wrapper debt was added. The host adapter keeps platform policy at the native boundary and continues to use the existing Effect RPC and Schema contract. Remaining debt: the macOS `windowId` target currently accepts the native capture window id used by `screencapture -l`, not an ORIKA `WindowHandle.id`; Windows and Linux adapters are still unsupported. `#1411` remains open for those gaps and for host-originated capture lifecycle events.

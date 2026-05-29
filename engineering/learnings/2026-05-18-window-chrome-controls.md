---
date: 2026-05-18
topic: window-chrome-controls
issue: 1345
---

# Window Chrome Controls

Mutable chrome should start with operations the host can execute uniformly. `setTitle`, `setResizable`, and `setDecorations` are portable Tao methods, so they can share the existing `Window` resource contract without inventing a separate chrome abstraction.

Creation-time macOS polish is a different contract from mutable chrome. Titlebar style, vibrancy, traffic lights, transparency, and shadows either depend on platform APIs or are currently only builder-time policy. Treating those as successful no-ops would make support metadata lie.

The useful line is explicit: portable mutable chrome lives on `Window`; platform-specific chrome remains open until it can report typed unsupported behavior per platform.

Architecture-debt sweep: no wrapper was removed. No new wrapper was added over Effect RPC or Schema; the change reused the existing bridge adapter as the native/web protocol boundary.

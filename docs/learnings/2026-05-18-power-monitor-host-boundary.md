# Power Monitor Host Boundary

Issue #1333 still requires OS-backed suspend, resume, shutdown, lock, unlock, and power-source event delivery. The safe incremental step was to add the Rust host support-query boundary without changing capability truth.

The host protocol now declares the current `PowerMonitor.isSupported` request and result shape, plus the event names used by the TypeScript surface. The Rust host dispatch registry routes `PowerMonitor.isSupported`, decodes the requested event method, and returns `{ supported: false }` for known methods while rejecting unknown method names.

The important guardrail is that support discovery is now executable host behavior instead of `MethodNotFound`, but the capability metadata still reports PowerMonitor as `unsupported` on macOS, Windows, and Linux. No OS watcher, event stream, lock/unlock contract, or successful support path was introduced.

Architecture-debt sweep: no wrapper removed. The current TypeScript PowerMonitor surface remains the public Effect boundary for stream contracts and bridge decoding. Remaining debt is the real native adapter: platform power watchers, permission/audit behavior, event ordering and replay policy, lock/unlock contract decisions, and end-to-end host coverage.

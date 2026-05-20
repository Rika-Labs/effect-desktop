---
title: RecentDocuments macOS adapter
---

# RecentDocuments macOS adapter

#1339 needed real OS recent-document behavior instead of a typed unsupported
boundary. The smallest complete slice is macOS, where AppKit owns the document
history through `NSDocumentController`.

The host now adds, clears, and lists macOS recent documents through
`NSDocumentController`. Windows and Linux still return typed `Unsupported` with
`host-adapter-unimplemented`. Successful host mutations publish
`RecentDocuments.Event` payloads so renderer streams can observe add and clear
state changes.

Verification:

- `cargo test -p host recent_document --bin host`
- `cargo test -p host-protocol recent_documents --lib`
- `cargo test -p host host_dispatch_registry_covers_host_protocol_methods --bin host`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'RecentDocuments|NativeCapabilities|NativeParityMatrix'`
- `bun desktop check --api`
- `git diff --check`

Architecture-debt sweep: no wrapper removed. `RecentDocuments` owns durable
desktop OS document-history semantics and remains a narrow native boundary, not
a shell helper or parallel Effect abstraction. No follow-up issue was opened;
Windows and Linux are explicitly documented as typed unsupported platforms until
a concrete platform primitive is chosen.

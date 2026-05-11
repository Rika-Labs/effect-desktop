# Clarify Committed Secret Audits

## Planned

Make `Secrets.set` and `Secrets.delete` failures unambiguous when SafeStorage commits but the success audit write fails.

## Shipped

Committed mutation audit failures now return `SecretsCommittedAuditFailed`, carrying the operation, namespace, key, and underlying `SecretsAuditFailed` cause. Tests prove both set and delete change durable storage before returning the committed error.

## Review Surface

Denied and storage-error audit failures still preserve the original pre-commit error. Only post-mutation success audit failures are reclassified as committed.

## Lesson

Mutation APIs need failure modes that say whether durable state changed. A generic audit failure after commit makes retry behavior guesswork.

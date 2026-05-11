# Match Native Invoke Audit Policy

## Planned

Prevent a `native.invoke` declaration with a weaker audit policy from covering a request that asks for stronger audit behavior.

## Shipped

`capabilityCovers` now treats `native.invoke.audit` as part of the authority shape alongside primitive and methods. The regression declares `Dialog.openFile` with `audit: "never"`, verifies a request with `audit: "always"` is denied, and verifies an exact same-audit request still grants.

## Lesson

Audit policy is not decoration on a permission object. When the normalized capability is the durable policy contract, the matcher must compare every field that changes the authority being granted.

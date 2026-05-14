# Match Secret Audit Policy

## Planned

Prevent secret and safe-storage declarations with weaker audit policies from covering stronger runtime requests.

## Shipped

`capabilityCovers` now compares `audit` for `secrets.read`, `secrets.write`, `safeStorage.read`, and `safeStorage.write`. The regression covers all four capability kinds and proves weaker `on-deny` declarations do not satisfy `always` requests while exact same-audit requests still grant.

## Lesson

Secret access audit policy changes the authority being granted. Namespace coverage alone is not enough when the request asks for a different audit contract.

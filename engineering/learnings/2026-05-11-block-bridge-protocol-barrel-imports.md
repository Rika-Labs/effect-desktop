# Block bridge protocol barrel imports

## Context

The production checker rejected `@orika/bridge/protocol` imports but allowed protocol envelope symbols imported from the public `@orika/bridge` barrel. Renderer code could construct host protocol envelopes while the production gate passed.

## Change

The renderer native-host rule now classifies bridge imports. It rejects protocol subpath imports and forbidden `HostProtocol*` or `HOST_PROTOCOL_*` symbols imported from the bridge barrel, while allowing non-protocol bridge imports. CLI coverage proves real renderer file scanning reports the same violation with file and line evidence.

## Lesson

Security checks must classify the capability, not just one import path. Public barrels can re-export privileged symbols, so renderer policy needs an export-level denylist for host protocol surfaces.

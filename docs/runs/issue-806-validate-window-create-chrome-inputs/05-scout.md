## Domain

Window creation chrome validation at the TypeScript SDK and bridge request boundary.

## Evidence gathered

- `packages/native/src/window.ts` decodes `WindowCreateInput` before calling the generated bridge client.
- `packages/bridge/src/window.ts` decodes `WindowCreatePayload` before constructing a `Window.create` host envelope.
- Both schemas already reject non-positive width and height, but allowed any title string, any vibrancy string, and finite negative traffic-light coordinates.
- `crates/host/src/macos.rs` defines the supported vibrancy materials and already rejects negative traffic-light offsets after the request reaches the host.
- `packages/native/src/index.test.ts` covers valid macOS polish fields and invalid width, but not invalid chrome values.

## First Principles

- What is true now: impossible chrome values can pass the SDK and bridge boundary as successful host requests.
- What must remain true: valid `Window.create` payloads keep the same wire shape and host ownership remains unchanged.
- What we want to be true: malformed chrome input fails as `InvalidArgument` before any host envelope is sent.

## Game Board

- Players: app code, SDK boundary, bridge encoder, native host, reviewers.
- Incentive risk: leaving validation to the host lets each caller path decide how much malformed chrome to permit.
- Bad local move: accept loose strings and coordinates because macOS has a later parser.
- Desired equilibrium: the first typed boundary rejects impossible chrome state, and the lower bridge boundary enforces the same contract for direct users.

## Constraints

- Keep the change inside existing schemas and tests.
- Do not change host protocol field names or valid request shape.
- Do not implement new Window mutators or platform behavior.
- Keep errors typed as existing `HostProtocolInvalidArgumentError`.

Handoff: /architect

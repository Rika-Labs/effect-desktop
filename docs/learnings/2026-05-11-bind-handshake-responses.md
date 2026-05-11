# Bind Handshake Responses

## Planned

Prevent the host handshake client from accepting a response envelope that belongs to another request.

## Shipped

`makeHostHandshakeClient` now keeps ping/version request envelopes in scope and checks the response id before success handling or version payload decoding. A mismatched response id fails as `InvalidOutput`.

## Lesson

Request identity belongs at every public exchange boundary. Even when the transport normally enforces correlation, local or mock exchanges must not be able to bypass the client invariant.

# Require Decimal JSON-RPC Content Lengths

## Planned

Close #472 by making JSON-RPC `Content-Length` parsing accept only wire-format decimal digits instead of JavaScript-coercible numbers.

## Shipped

`parseContentLength` now trims the header value, requires `[0-9]+`, then parses base 10 and keeps the existing safe-integer and frame-size bounds. Signs, decimals, exponents, `NaN`, `Infinity`, and empty values fail as header invalid arguments before payload delivery.

## Review

The regression test covers the rejected non-decimal forms and keeps a whitespace-padded decimal header valid. Duplicate-header handling remains out of scope for #471.

## Lesson

Wire formats need grammars, not language coercion. `Number(...)` is convenient, but it accepts syntax a protocol peer may reject.

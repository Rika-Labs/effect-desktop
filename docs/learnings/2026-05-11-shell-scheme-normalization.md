# Shell scheme normalization

## Planned

Close issue #577 by making `Shell.openExternal` compare app-declared allowed schemes case-insensitively.

## Shipped

`ShellOpenExternalInput` now carries optional `allowedSchemes`. The Shell bridge client normalizes those entries to lowercase, colon-free scheme names before policy comparison, while reserved schemes such as `file` and `javascript` remain denied.

## Review surfaced

The parsed URL scheme was already canonicalized, but the allow list was not part of the input contract and was ignored by option normalization. That made custom schemes impossible to allow through the bridge client.

## Lesson

Policy inputs and parsed values need the same canonical form before comparison. A policy option that is not represented in the contract is not a policy option at runtime.

## AGENTS.md amendment candidate

None.

# Validate Core Runtime Options

## Planned

Keep core runtime configuration and generated trace IDs inside typed failure boundaries.

## Shipped

Process runtime budget options now fail during service construction unless each budget is a positive safe integer. ApprovalBroker already validated generated trace IDs through its schema decoder; the regression now covers the empty-string generator case and proves no prompt or audit side effect occurs.

## Lesson

Configuration errors should fail before runtime state exists. Generated metadata needs the same validation as caller-supplied metadata, with tests that prove invalid generators do not trigger downstream side effects.

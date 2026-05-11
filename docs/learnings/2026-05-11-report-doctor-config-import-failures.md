# Report Doctor Config Import Failures

## Planned

Make `desktop doctor` distinguish config import failures from configs that import successfully but do not export a default object.

## Shipped

The config probe now has separate stages for file existence, dynamic import, default-object validation, and metadata validation. Import failures produce a config probe failure that says `desktop config import failed` and includes a concise cause.

## Lesson

Diagnostics must name the boundary that failed. Collapsing parse/import errors into schema errors sends users to edit the wrong part of the system.

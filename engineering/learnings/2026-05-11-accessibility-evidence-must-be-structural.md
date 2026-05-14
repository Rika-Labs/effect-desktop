# Accessibility evidence must be structural

## Context

The accessibility gate accepted two paper-evidence shapes: axe reports with no passed rules and required tokens that existed only in comments. Both let a release claim accessibility coverage without proving that a scan ran or that the template kept the behavior.

## Change

The gate now rejects axe audits with empty `passes` arrays. Required token checks strip source comments, and the media-query tokens require real `@media (...)` rules for `prefers-reduced-motion` and `prefers-color-scheme`.

## Lesson

Release gates should validate the structure that carries behavior, not raw substrings. A magic word in a comment is not evidence, and an empty success list is not a scan.

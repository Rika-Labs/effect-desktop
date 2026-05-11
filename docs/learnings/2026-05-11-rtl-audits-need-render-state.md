# RTL audits need render state

## Context

The accessibility manifest declared RTL audit modes, but the template always rendered English LTR copy. The Arabic messages existed as data, not as a rendered template state.

## Change

The basic React template now resolves locale, direction, and copy through one helper and renders `lang` and `dir` on the root element. The accessibility gate requires audit URLs to match each mode's direction and color scheme, and RTL modes must target Arabic with `lang=ar`.

## Lesson

Localization evidence must bind to a rendered state. A message table entry is not RTL coverage until the template can render it and the release evidence points at that state.

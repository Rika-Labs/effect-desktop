# Issue 815 Work

Changes:

- Added `DialogDisplayText` in the Dialog contract file.
- Applied it to file dialog titles, message title/message/detail, and confirm title/message/detail/button labels.
- Preserved omission as the way to use platform defaults.
- Added a bridge-client regression test proving invalid UI text fails before transport.

Verification:

- `bun test packages/native/src/index.test.ts` — passed.
- `bun run typecheck` — passed.
- `bun run lint:types` — passed.
- Changed-file Prettier check — passed.

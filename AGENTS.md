## Vendored repositories

External source repositories are vendored under `repos/` as squashed git subtrees, not submodules. Treat them as read-only reference material for humans and agents.

- Do not edit files under `repos/` unless explicitly asked to update or patch a subtree.
- Do not import from `repos/`; application and framework code must import from declared package dependencies.
- Prefer vendored source, tests, and examples over generated guesses or generic web search when grounding library behavior.
- When writing Effect v4 code, inspect `repos/effect-smol/` for idiomatic usage, tests, module structure, and API design.
- Use `repos/effect/` as the regular upstream Effect repository reference when comparing broader upstream history, package layout, or non-smol implementation details.
- Before writing Effect code, read `repos/effect-smol/LLMS.md`, then inspect the relevant `repos/effect-smol/ai-docs/src/**` examples and `repos/effect-smol/packages/**` source/tests.

Add new reference repositories as subtrees under `repos/<name>`:

```bash
git subtree add \
  --prefix=repos/<name> \
  <repository-url> \
  <branch> \
  --squash
```

Subtrees need no post-clone initialization. A fresh clone already contains the vendored source; do not run `git submodule update --init`.

Update an existing subtree with:

```bash
git subtree pull \
  --prefix=repos/<name> \
  <repository-url> \
  <branch> \
  --squash
```

Effect v4 smol is vendored at `repos/effect-smol` from `https://github.com/Effect-TS/effect-smol.git` on `main`:

```bash
git subtree pull \
  --prefix=repos/effect-smol \
  https://github.com/Effect-TS/effect-smol.git \
  main \
  --squash
```

Regular upstream Effect is vendored at `repos/effect` from `https://github.com/Effect-TS/effect.git` on `main`:

```bash
git subtree pull \
  --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git \
  main \
  --squash
```

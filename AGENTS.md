## Hard Rules

Every active goal must include an architecture-debt sweep. For each ticket or issue, inspect the area being touched for adapters, thin wrapper layers, custom DSLs, bridge specs, convenience APIs, or parallel abstractions over Effect.

Effect primitives are the default architecture. Custom abstractions must justify themselves by owning durable desktop-specific policy, lifecycle, security, or protocol translation. If an abstraction only renames, mirrors, narrows, adapts, or partially reimplements Effect APIs, treat it as architecture debt.

Bridge contracts are boundary descriptions, not an internal DSL. Prefer canonical Effect RPC, Effect Schema, Layer, Stream, Schedule, Scope, and Config contracts directly; keep bridge-specific helpers only where they translate across the native/web boundary or enforce durable protocol policy.

`BridgeRpc` is not a permanent architecture target. Keep it only as a small boundary adapter while it carries native/web protocol semantics that Effect RPC does not yet own locally; remove it once canonical Effect RPC can express the same contract directly.

Avoid `unknown as` and other type assertions in Effect-owned code. Use Schema decoding, typed services, generic constraints, or explicit boundary constructors instead. If an assertion is unavoidable at an external boundary, keep it local, document the invariant, and open a follow-up issue when the assertion points at missing Effect-native typing.

For every ticket, actively look for areas like `BridgeRpc`: adapters, thin layers, custom DSLs, bridge specs, or convenience APIs that sit over Effect without adding durable desktop semantics. Do this even when the ticket is about nearby code rather than the wrapper itself.

If a wrapper is not adding durable desktop-specific semantics, remove it as part of the current work.

If removal is larger than the current ticket, open a follow-up GitHub issue with a concrete before/after that shows the current custom abstraction and the desired Effect-native shape. The issue must explain why the wrapper is debt, what durable semantics must remain, and how the code should rely on Effect directly.

Before closing each ticket, record the architecture-debt sweep outcome: wrappers removed, follow-up issues opened, or no debt found in the touched area. Do not close the ticket without this note.

Track follow-up issues in the roadmap when they unblock or simplify later work. Do not preserve legacy compatibility solely for prerelease APIs; prefer the simpler Effect-native interface and migrate call sites fully.

# Repository Guidelines

## Project Structure & Module Organization

Effect Desktop is a Bun/TypeScript monorepo with Rust host crates. Framework packages live in `packages/*`, example and docs apps in `apps/*`, reusable starters in `templates/*`, Rust code in `crates/*`, repo-level tests in `tests/*`, and API snapshots in `api/snapshots`. Design notes, ADRs, milestones, and operational docs live under `docs/`. External reference repositories are vendored as read-only git subtrees under `repos/`; do not import from or edit them unless explicitly updating a subtree.

## Build, Test, and Development Commands

Use Bun 1.3.13, as pinned in `package.json`.

- `bun install --frozen-lockfile`: install dependencies exactly from `bun.lock`.
- `bun run dev`: run package/app development tasks through Turbo.
- `bun run build`: build all workspace targets.
- `bun run check`: run Ultracite formatting and lint checks.
- `bun run typecheck`: run TypeScript type checks.
- `bun run lint` and `bun run lint:types`: run normal and type-aware linting.
- `bun run format:check`: verify Ultracite formatting and lint checks.
- `bun test`: run Bun tests.
- `cargo check --workspace`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`: validate Rust crates.

## Coding Style & Naming Conventions

TypeScript uses strict compiler settings and Ultracite with Oxlint/Oxfmt. Keep public effectful APIs as `Effect.Effect<A, E, R>` except at explicit integration edges. Import Effect symbols from `effect`, use `Schema.Class` for boundary data, and model expected failures with stable tagged errors. Prefer small, explicit modules and avoid shallow wrappers. Formatting is Ultracite-managed; do not hand-format vendored files.

Public effectful capability design must follow the Layer-first contract in `docs/architecture/layer-first-contract.md`.

## Testing Guidelines

Place package tests beside source as `src/*.test.ts` or in package test directories following existing patterns. Use Bun test for TypeScript and Cargo test for Rust. When replacing a Phase 0 stub, replace the placeholder test with a real assertion. Public capabilities should include deterministic test layers or fixtures that avoid real OS prompts, network services, or native hosts.

## Commit & Pull Request Guidelines

Follow the existing history: concise Conventional Commit-style subjects such as `fix(react): ...`, `refactor(core): ...`, or `docs: ...`; include issue references when applicable. PRs should explain the user-visible change, link the issue, and note verification performed. Include screenshots only for UI-facing changes.

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

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Oxlint + Oxfmt (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Oxlint + Oxfmt Can't Help

Oxlint + Oxfmt's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Oxlint + Oxfmt can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Oxlint + Oxfmt. Run `bun x ultracite fix` before committing to ensure compliance.

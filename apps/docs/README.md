# @effect-desktop/docs

Deployable documentation web app for Effect Desktop.

## Commands

```bash
bun run dev        # next dev on 127.0.0.1:3001
bun run build      # next build
bun run typecheck  # fumadocs-mdx + tsc --noEmit
bun run lint       # oxlint
bun run deploy -- --stage prod
bun run deploy -- --stage pr-123
bun run destroy -- --stage pr-123
```

## Cloudflare deployment

The docs site deploys through Alchemy v2 as a static Next export on Cloudflare
Workers Static Assets. Production uses the `prod` stage and the
`effect-desktop-docs` Worker. Pull requests use disposable `pr-<number>` stages
and are cleaned up when the PR closes.

GitHub Actions needs these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The Cloudflare token must be scoped to the target account and include, for this
first deployment path:

- Workers Scripts Write
- Secrets Store Write
- Account Settings Write
- Workers Tail Read

Local deploys use Alchemy's stored OAuth credentials for Cloudflare and the
GitHub CLI credential flow for preview comments. The first local Cloudflare
deploy may prompt to create the `alchemy-state-store` Worker; accept that prompt
for this repo/account.

## Dependency note

This app uses the same documentation stack already present in `apps/playground`: Next.js 16, React 19, Tailwind CSS 4, Fumadocs UI, Fumadocs core, and Fumadocs MDX. No new dependency family is introduced; the docs app separates the deployable web surface from the desktop playground renderer.

`@effect/platform-node` is present as an Alchemy deploy-time peer dependency. Alchemy's Cloudflare Worker bundler imports it while creating the Cloudflare state-store Worker, even though the docs application itself runs on Next.js and Cloudflare Workers Static Assets.

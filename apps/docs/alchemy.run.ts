import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as GitHub from "alchemy/GitHub"
import * as Output from "alchemy/Output"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

const DocsSite = Cloudflare.StaticSite(
  "DocsSite",
  Alchemy.Stack.useSync((stack) => ({
    command: "bun run build",
    outdir: "out",
    main: "./worker.ts",
    name: stack.stage === "prod" ? "effect-desktop-docs" : `effect-desktop-docs-${stack.stage}`,
    url: true,
    compatibility: {
      date: "2026-05-11"
    },
    assetsConfig: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "404-page"
    }
  }))
)

export default Alchemy.Stack(
  "EffectDesktopDocs",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state()
  },
  Effect.gen(function* () {
    const site = yield* DocsSite
    const pullRequest = process.env.PULL_REQUEST

    if (pullRequest !== undefined && pullRequest.length > 0) {
      yield* GitHub.Comment("preview-comment", {
        owner: "Rika-Labs",
        repository: "effect-desktop",
        issueNumber: Number(pullRequest),
        body: Output.interpolate`
          ## Docs Preview Deployed

          **URL:** ${site.url}

          Built from commit ${
            process.env.BUILD_SHA
              ? `[\`${process.env.BUILD_SHA.slice(0, 7)}\`](https://github.com/Rika-Labs/effect-desktop/commit/${process.env.BUILD_SHA})`
              : "unknown"
          }.

          ---
          _This comment updates automatically with each push._
        `
      })
    }

    return {
      url: site.url
    }
  })
)

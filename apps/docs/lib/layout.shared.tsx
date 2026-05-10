import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="text-emerald-500">
            ED
          </span>
          Effect Desktop
        </span>
      ),
      url: "/"
    },
    githubUrl: "https://github.com/Rika-Labs/effect-desktop"
  }
}


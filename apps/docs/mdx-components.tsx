import defaultMdxComponents from "fumadocs-ui/mdx"
import { Callout } from "fumadocs-ui/components/callout"
import { Card, Cards } from "fumadocs-ui/components/card"
import * as TabsComponents from "fumadocs-ui/components/tabs"
import type { MDXComponents } from "mdx/types"

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...TabsComponents,
    Callout,
    Card,
    Cards,
    ...components
  }
}

import defaultMdxComponents from "fumadocs-ui/mdx"
import * as TabsComponents from "fumadocs-ui/components/tabs"
import { Callout } from "fumadocs-ui/components/callout"
import { Card, Cards } from "fumadocs-ui/components/card"
import type { MDXComponents } from "mdx/types"

import { Example } from "@/components/example"

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...TabsComponents,
    Callout,
    Card,
    Cards,
    Example,
    ...components
  }
}

import { RootProvider } from "fumadocs-ui/provider/next"
import type { ReactNode } from "react"

import "./global.css"

export const metadata = {
  title: "Effect Desktop",
  description: "A typed desktop framework for native power without hidden failure."
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}


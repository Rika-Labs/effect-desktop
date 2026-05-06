#!/usr/bin/env bun
import { Effect } from "effect"

import { runCli } from "./index.js"

const exitCode = await Effect.runPromise(
  runCli({
    argv: Bun.argv.slice(2),
    cwd: process.cwd(),
    writeStdout: (text) => {
      process.stdout.write(text)
    },
    writeStderr: (text) => {
      process.stderr.write(text)
    }
  })
)

process.exit(exitCode)

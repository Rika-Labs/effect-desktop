#!/usr/bin/env bun
import { runPackInstallableCliMain } from "../packages/cli/src/pack-installable-cli.js"

runPackInstallableCliMain(Bun.argv.slice(2), process.cwd())

#!/usr/bin/env node
import { runStdio } from '../src/server.js'

runStdio().catch((error) => {
  process.stderr.write(`hup-mcp failed to start: ${error?.message ?? error}\n`)
  process.exit(1)
})

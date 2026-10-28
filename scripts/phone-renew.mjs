#!/usr/bin/env node
// Run as a separate local issuer. The publisher receives only its scoped output.
import { renewFromConfig } from './phone-renew-core.mjs'
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/phone-renew.mjs --config /absolute/private/renewal-config.json')
} else {
  process.umask(0o077)
  try {
    if (args.length !== 2 || args[0] !== '--config') throw Error('arguments')
    console.log(JSON.stringify(await renewFromConfig(args[1])))
  } catch {
    console.error('Screen capability renewal failed. Check private file ownership, permissions, paths, capability validity, and issuer lock. No credential was printed.')
    process.exitCode = 1
  }
}

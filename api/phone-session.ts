import { hasStore, redis } from './_lib.js'
import { phoneSessionHandler } from './_phone-session.js'

// The publisher is configured separately on the Mac. Visitors receive only a
// short-lived subscription grant, never the LiveKit server credentials.
export const GET = phoneSessionHandler({ env: () => process.env, hasStore, redis })

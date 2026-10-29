import { ingestScope } from '../_ingest-auth.js'
import { hasStore } from '../_lib.js'
import { isLaunchCursor, readLaunchEvents } from '../_launch-events.js'

const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// Read-only delivery cursor, not an execution acknowledgement or signing grant.
export async function GET(req: Request) {
  const scope = ingestScope(req.headers.get('authorization'), process.env.INGEST_TOKEN || '')
  if (!scope) return out({ error: 'unauthorised' }, 401)
  if (scope !== 'full') return out({ error: 'full ingestion credential required' }, 403)
  const query = new URL(req.url).searchParams
  const after = query.get('after') ?? '0'
  const count = query.get('limit') ?? '50'
  if (query.getAll('after').length > 1 || query.getAll('limit').length > 1 || !isLaunchCursor(after)
    || !/^[1-9][0-9]{0,2}$/.test(count) || Number(count) > 100) return out({ error: 'invalid cursor or page size' }, 400)
  if (!hasStore()) return out({ error: 'launch outbox unavailable' }, 503)
  try {
    return out(await readLaunchEvents(after, Number(count)))
  } catch (error) {
    if (error instanceof Error && error.message === 'cursor-ahead') return out({ error: 'cursor is ahead of the launch outbox; review required' }, 409)
    return out({ error: 'launch outbox unavailable; cursor was not advanced' }, 503)
  }
}

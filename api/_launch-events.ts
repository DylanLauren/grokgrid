import { isAddress, redis } from './_lib.js'

export const launchEventKeys = {
  payloads: 'gg:launch:event-payloads',
  order: 'gg:launch:event-order',
  sequence: 'gg:launch:event-sequence',
} as const

export const launchEventCoverage = 'confirmed-launches-after-outbox-deployment' as const

export type LaunchEvent = { cursor: string; id: string; mint: string; wallet: string; ts: number }

export function isLaunchCursor(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value) && Number.isSafeInteger(Number(value))
}

// Validate the complete reply before returning any cursor. An unavailable or corrupt
// item must never be skipped by a worker advancing to the next page.
export function decodeLaunchEvents(raw: unknown, after: string, limit: number) {
  if (!isLaunchCursor(after) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid-query')
  if (!Array.isArray(raw) || raw.length !== 2 || !isLaunchCursor(raw[0]) || !Array.isArray(raw[1])) throw new Error('invalid-outbox')
  const [headCursor, rows] = raw as [string, unknown[]]
  if (Number(after) > Number(headCursor)) throw new Error('cursor-ahead')
  if (rows.length > limit + 1) throw new Error('invalid-outbox')
  let previous = Number(after)
  const mints = new Set<string>()
  const events: LaunchEvent[] = rows.map(row => {
    if (!Array.isArray(row) || row.length !== 3 || !isLaunchCursor(row[0]) || typeof row[1] !== 'string' || typeof row[2] !== 'string' || row[2].length > 4_096) throw new Error('invalid-outbox')
    const cursor = Number(row[0])
    if (cursor <= previous || cursor > Number(headCursor)) throw new Error('invalid-outbox')
    const event = JSON.parse(row[2]) as Record<string, unknown> | null
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.id !== 'string' || !/^[a-z0-9-]{2,32}$/.test(event.id)
      || !isAddress(event.mint) || !isAddress(event.wallet) || event.mint !== row[1] || mints.has(event.mint)
      || !Number.isSafeInteger(event.ts) || Number(event.ts) <= 0) throw new Error('invalid-outbox')
    previous = cursor
    mints.add(event.mint)
    return { cursor: row[0], id: event.id, mint: event.mint, wallet: event.wallet, ts: event.ts as number }
  })
  const hasMore = events.length > limit
  const page = events.slice(0, limit)
  const nextCursor = page.at(-1)?.cursor ?? after
  // A nonempty head cannot be hidden behind an empty/truncated range reply.
  if (!hasMore && nextCursor !== headCursor) throw new Error('invalid-outbox')
  return { version: 1 as const, events: page, nextCursor, headCursor, hasMore, coverage: launchEventCoverage, executionEnabled: false as const }
}

export async function readLaunchEvents(after: string, limit: number) {
  const [raw] = await redis(['EVAL', `
    local expected = {'zset', 'hash'}
    for i = 1, 2 do
      local kind = redis.call('TYPE', KEYS[i]).ok
      if kind ~= 'none' and kind ~= expected[i] then return false end
    end
    local head = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    local rows = redis.call('ZRANGEBYSCORE', KEYS[1], '(' .. ARGV[1], '+inf', 'WITHSCORES', 'LIMIT', 0, ARGV[2])
    local events = {}
    for i = 1, #rows, 2 do
      local payload = redis.call('HGET', KEYS[2], rows[i])
      if not payload then return false end
      table.insert(events, {rows[i + 1], rows[i], payload})
    end
    return {head[2] or '0', events}
  `, 2, launchEventKeys.order, launchEventKeys.payloads, after, limit + 1])
  return decodeLaunchEvents(raw, after, limit)
}

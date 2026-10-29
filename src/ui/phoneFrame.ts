const FRAME_FRESH_MS = 12_000

export function freshFrameTimestamp(value: string | null, now: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const ts = Number(value)
  return Number.isSafeInteger(ts) && ts > 0 && ts <= now && now - ts < FRAME_FRESH_MS ? ts : null
}

// Fetch the current frame once; its own header identifies these exact bytes.
// The live-status timestamp is only a polling trigger and may already be superseded.
export async function fetchPhoneFrame(signal: AbortSignal, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const response = await fetcher('/api/screen', { signal, cache: 'no-store' })
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg') throw Error('frame-unavailable')
  const timestamp = response.headers.get('x-frame-timestamp')
  if (freshFrameTimestamp(timestamp, now()) === null) throw Error('frame-expired')
  const blob = await response.blob()
  const ts = freshFrameTimestamp(timestamp, now())
  if (signal.aborted || ts === null || !blob.size || blob.size > 450_000) throw Error('frame-unavailable')
  return { ts, blob }
}

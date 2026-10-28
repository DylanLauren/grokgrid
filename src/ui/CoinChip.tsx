import { useState } from 'react'
import type { Call } from '../data/types'

export function CoinChip({ call, size }: { call: Pick<Call, 'hue' | 'image' | 'symbol'>; size: number }) {
  const [failed, setFailed] = useState<string | undefined>()
  const image = call.image && failed !== call.image ? call.image : undefined
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: call.hue,
        overflow: 'hidden',
        display: 'inline-grid',
        placeItems: 'center',
        flex: 'none',
        fontFamily: 'var(--mono)',
        fontSize: size * 0.34,
        fontWeight: 600,
        color: dark(call.hue) ? '#ffffff' : '#0a0a0a',
        boxShadow: 'inset 0 0 0 1px #ffffff24', // keeps dark coins visible on the dark page
      }}
    >
      {image ? <img src={image} alt={`${call.symbol} token`} width={size} height={size} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(image)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : call.symbol.slice(0, 1)}
    </span>
  )
}

const dark = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16)
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 90
}

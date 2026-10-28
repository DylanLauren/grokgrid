import type { Call } from '../data/types'

export function CoinChip({ call, size }: { call: Pick<Call, 'hue' | 'image' | 'symbol'>; size: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: call.image ? `center / cover url(${call.image})` : call.hue,
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
      {call.image ? '' : call.symbol.slice(0, 1)}
    </span>
  )
}

const dark = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16)
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 90
}

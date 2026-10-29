// The bot family, drawn flat and matte like the official Grok Bots. "house" is our white bot.
import { eyeInk, eyePaths } from './eyes'

export type Shape = 'sphere' | 'squircle' | 'cloud' | 'cone' | 'drop' | 'tile'

export const FAMILY: { color: string; shape: Shape; name: string }[] = [
  { color: '#0b0b0b', shape: 'sphere', name: 'black' },
  { color: '#ff6a00', shape: 'sphere', name: 'orange' },
  { color: '#ff9a00', shape: 'cloud', name: 'amber' },
  { color: '#13b8a6', shape: 'squircle', name: 'teal' },
  { color: '#9b5cff', shape: 'tile', name: 'violet' },
  { color: '#1683ff', shape: 'squircle', name: 'blue' },
  { color: '#ff2e9a', shape: 'cone', name: 'pink' },
  { color: '#7a7a7a', shape: 'drop', name: 'grey' },
  { color: '#9a6a3f', shape: 'sphere', name: 'brown' },
]

export const BODY: Record<Shape, string> = {
  sphere: 'M50 6a44 44 0 1 1 0 88a44 44 0 1 1 0-88z',
  squircle: 'M30 8h40c16 0 24 8 24 24v36c0 16-8 24-24 24H30C14 92 6 84 6 68V32C6 16 14 8 30 8z',
  tile: 'M28 12l46-4c12-1 20 6 20 18l-2 40c-1 14-9 22-22 24l-40 4C18 95 8 88 8 74V34c0-12 8-21 20-22z',
  cloud: 'M30 30a20 20 0 0 1 36-8a18 18 0 0 1 26 18a20 20 0 0 1-6 38H22a18 18 0 0 1-6-34a16 16 0 0 1 14-14z',
  cone: 'M50 8c6 0 10 6 14 14l26 56c4 10-2 16-12 16H22c-10 0-16-6-12-16l26-56c4-8 8-14 14-14z',
  drop: 'M54 8c4 0 8 4 14 14c14 22 22 36 22 48a40 40 0 0 1-80 0c0-18 22-38 34-54c4-6 6-8 10-8z',
}


// The logo pose: glancing up and to the right, as on xAI's Grok Bot mark.
export const LOGO_LOOK: [number, number] = [0.45, -0.35]

export function BotMark({ size = 28, color = 'house', shape = 'sphere', look = LOGO_LOOK }: { size?: number; color?: string; shape?: Shape; look?: [number, number] }) {
  const house = color === 'house'
  const ink = house ? '#1a1a1a' : eyeInk(color)
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={BODY[shape]} fill={house ? '#ffffff' : color} />
      {eyePaths(shape, look[0], look[1]).map((d, i) => (
        <path key={i} d={d} fill={ink} />
      ))}
    </svg>
  )
}

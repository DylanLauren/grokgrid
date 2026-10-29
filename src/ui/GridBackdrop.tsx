import { useEffect, useRef } from 'react'
import { FAMILY } from './BotMark'

// The grid behind every page. It leans toward the pointer and lights up around it; moving
// leaves soft ripples behind, a click sends a bigger one. Each ripple takes one of the bot
// family's colours. Still when the tab is hidden; a plain grid with reduced motion.
const STEP = 56
const SPEED = 0.55 // px per ms a ripple ring travels
const LIFE = 1800 // ms a ripple lasts
const COLORS = FAMILY.filter((f) => f.name !== 'black').map((f) => f.color)

type Ripple = { x: number; y: number; t: number; amp: number; color: string }

export function GridBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1
    let px = -9999, py = -9999, lx = -9999, ly = -9999 // pointer, eased toward it
    let lastDrop = 0, dropX = -9999, dropY = -9999, colorAt = 0
    const ripples: Ripple[] = []
    let raf = 0
    let xs = new Float32Array(0), ys = new Float32Array(0), glow = new Float32Array(0), tint = new Int16Array(0)

    const size = () => {
      dpr = Math.min(devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      cols = Math.ceil(w / STEP) + 2
      rows = Math.ceil(h / STEP) + 2
      xs = new Float32Array(cols * rows)
      ys = new Float32Array(cols * rows)
      glow = new Float32Array(cols * rows)
      tint = new Int16Array(cols * rows)
      if (still || !raf) draw(performance.now())
    }

    const drop = (x: number, y: number, amp: number, now: number) => {
      ripples.push({ x, y, t: now, amp, color: COLORS[colorAt++ % COLORS.length] })
      if (ripples.length > 14) ripples.shift()
    }

    const draw = (now: number) => {
      lx += (px - lx) * 0.18
      ly += (py - ly) * 0.18
      while (ripples.length && now - ripples[0].t > LIFE) ripples.shift()
      // where each grid point sits this frame
      const ox = -STEP + ((w % STEP) / 2), oy = -STEP + ((h % STEP) / 2)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          const bx = ox + c * STEP, by = oy + r * STEP
          let x = bx, y = by, g = 0, best = 0, tinted = -1
          // the pointer is a soft lens: points lean in and brighten
          const dx = lx - bx, dy = ly - by
          const d2 = dx * dx + dy * dy
          if (d2 < 220 * 220) {
            const k = 1 - Math.sqrt(d2) / 220
            x += dx * k * k * 0.22
            y += dy * k * k * 0.22
            g += k * k * 0.9
          }
          for (let j = 0; j < ripples.length; j++) {
            const rp = ripples[j]
            const age = now - rp.t
            const rx = bx - rp.x, ry = by - rp.y
            const d = Math.sqrt(rx * rx + ry * ry) || 1
            const off = d - age * SPEED
            if (off > 90 || off < -90) continue
            const fade = 1 - age / LIFE
            const band = Math.exp(-(off * off) / 1400) * fade * rp.amp
            // a ring that pushes points out, with a little trough behind it
            const push = band * 14 * Math.cos(off / 18)
            x += (rx / d) * push
            y += (ry / d) * push
            g += band
            if (band > best) { best = band; tinted = j }
          }
          xs[i] = x
          ys[i] = y
          glow[i] = Math.min(1, g)
          tint[i] = best > 0.18 ? COLORS.indexOf(ripples[tinted].color) : -1
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.lineWidth = 1
      // base lines in one pass, then the lit segments on top
      ctx.strokeStyle = 'rgba(255,255,255,0.045)'
      ctx.beginPath()
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          if (c + 1 < cols) { ctx.moveTo(xs[i], ys[i]); ctx.lineTo(xs[i + 1], ys[i + 1]) }
          if (r + 1 < rows) { ctx.moveTo(xs[i], ys[i]); ctx.lineTo(xs[i + cols], ys[i + cols]) }
        }
      }
      ctx.stroke()
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          const g = glow[i]
          if (g < 0.04) continue
          const color = tint[i] >= 0 ? COLORS[tint[i]] : '#ffffff'
          ctx.strokeStyle = color
          ctx.globalAlpha = g * (tint[i] >= 0 ? 0.55 : 0.28)
          ctx.beginPath()
          if (c + 1 < cols) { ctx.moveTo(xs[i], ys[i]); ctx.lineTo(xs[i + 1], ys[i + 1]) }
          if (r + 1 < rows) { ctx.moveTo(xs[i], ys[i]); ctx.lineTo(xs[i + cols], ys[i + cols]) }
          ctx.stroke()
          // a dot where lines cross
          ctx.globalAlpha = g * 0.9
          ctx.fillStyle = color
          ctx.fillRect(xs[i] - 1, ys[i] - 1, 2, 2)
          ctx.globalAlpha = 1
        }
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden) return
      draw(now)
    }

    const move = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect()
      px = e.clientX - b.left
      py = e.clientY - b.top
      if (lx < -9000) { lx = px; ly = py }
      const now = performance.now()
      // moving drops a small ripple every so often, once the pointer has travelled a bit
      if (now - lastDrop > 140 && Math.hypot(px - dropX, py - dropY) > 70) {
        drop(px, py, 0.55, now)
        lastDrop = now
        dropX = px
        dropY = py
      }
    }
    const down = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect()
      drop(e.clientX - b.left, e.clientY - b.top, 1, performance.now())
    }
    const leave = () => { px = py = -9999 }

    size()
    const ro = new ResizeObserver(size)
    ro.observe(canvas)
    if (!still) {
      addEventListener('pointermove', move, { passive: true })
      addEventListener('pointerdown', down, { passive: true })
      document.addEventListener('pointerleave', leave)
      raf = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      removeEventListener('pointermove', move)
      removeEventListener('pointerdown', down)
      document.removeEventListener('pointerleave', leave)
    }
  }, [])

  return <canvas ref={ref} className="pg-grid" aria-hidden="true" />
}

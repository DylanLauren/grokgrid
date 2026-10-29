import { useEffect, useRef } from 'react'

// The grid behind every page. It leans toward the pointer and lifts a shade around it,
// close to the background so it never pulls focus.
// Still when the tab is hidden; a plain grid with reduced motion.
const STEP = 56

export function GridBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1
    let px = -9999, py = -9999, lx = -9999, ly = -9999 // pointer, eased toward it
    let raf = 0
    let xs = new Float32Array(0), ys = new Float32Array(0), glow = new Float32Array(0)

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
      if (still || !raf) draw()
    }

    const draw = () => {
      lx += (px - lx) * 0.18
      ly += (py - ly) * 0.18
      // where each grid point sits this frame
      const ox = -STEP + ((w % STEP) / 2), oy = -STEP + ((h % STEP) / 2)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          const bx = ox + c * STEP, by = oy + r * STEP
          let x = bx, y = by, g = 0
          // the pointer is a soft lens: points lean in and brighten
          const dx = lx - bx, dy = ly - by
          const d2 = dx * dx + dy * dy
          if (d2 < 220 * 220) {
            const k = 1 - Math.sqrt(d2) / 220
            x += dx * k * k * 0.22
            y += dy * k * k * 0.22
            g += k * k * 0.9
          }
          xs[i] = x
          ys[i] = y
          glow[i] = Math.min(1, g)
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
          ctx.strokeStyle = '#ffffff'
          ctx.globalAlpha = g * 0.09
          ctx.beginPath()
          if (c + 1 < cols) { ctx.moveTo(xs[i], ys[i]); ctx.lineTo(xs[i + 1], ys[i + 1]) }
          if (r + 1 < rows) { ctx.moveTo(xs[i], ys[i]); ctx.lineTo(xs[i + cols], ys[i + cols]) }
          ctx.stroke()
          // a dot where lines cross
          ctx.globalAlpha = g * 0.18
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(xs[i] - 1, ys[i] - 1, 2, 2)
          ctx.globalAlpha = 1
        }
      }
    }

    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (document.hidden) return
      draw()
    }

    const move = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect()
      px = e.clientX - b.left
      py = e.clientY - b.top
      if (lx < -9000) { lx = px; ly = py }
    }
    const leave = () => { px = py = -9999 }

    size()
    const ro = new ResizeObserver(size)
    ro.observe(canvas)
    if (!still) {
      addEventListener('pointermove', move, { passive: true })
      document.addEventListener('pointerleave', leave)
      raf = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
    }
  }, [])

  return <canvas ref={ref} className="pg-grid" aria-hidden="true" />
}

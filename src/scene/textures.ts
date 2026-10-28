import * as THREE from 'three'

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function rand(seed: number) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// The view out of his window: a city that is also awake at 3am.
export function cityTexture() {
  return canvas(1024, 1024, (g) => {
    const r = rand(7)
    const sky = g.createLinearGradient(0, 0, 0, 1024)
    sky.addColorStop(0, '#05070d')
    sky.addColorStop(0.6, '#0b1222')
    sky.addColorStop(1, '#1a1a24')
    g.fillStyle = sky
    g.fillRect(0, 0, 1024, 1024)
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`
      g.fillRect(r() * 1024, r() * 420, 1.5, 1.5)
    }
    // moon
    g.fillStyle = '#e9ecf2'
    g.beginPath()
    g.arc(760, 170, 46, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#0a0f1c'
    g.beginPath()
    g.arc(782, 156, 42, 0, Math.PI * 2)
    g.fill()
    // two rows of towers, far ones dimmer
    for (const [base, dim, minH, maxH] of [
      [1024, 0.45, 220, 520],
      [1024, 1, 140, 380],
    ] as const) {
      let x = -20
      while (x < 1024) {
        const w = 60 + r() * 110
        const h = minH + r() * (maxH - minH)
        g.fillStyle = dim < 1 ? '#0d1220' : '#07090f'
        g.fillRect(x, base - h, w, h)
        for (let wy = base - h + 12; wy < base - 8; wy += 16) {
          for (let wx = x + 8; wx < x + w - 8; wx += 12) {
            if (r() < 0.32) {
              const warm = r() < 0.7
              g.fillStyle = warm ? `rgba(255,200,130,${0.35 * dim + r() * 0.4 * dim})` : `rgba(150,200,255,${0.3 * dim})`
              g.fillRect(wx, wy, 5, 7)
            }
          }
        }
        x += w + 4 + r() * 10
      }
    }
  })
}

// A poster of the bot family on his wall, after the @bot banner.
export function familyPoster() {
  return canvas(1024, 720, (g) => {
    g.fillStyle = '#f2f3f5'
    g.fillRect(0, 0, 1024, 720)
    const eye = (x: number, y: number, h: number, tilt: number, color = '#fff') => {
      g.save()
      g.translate(x, y)
      g.rotate(tilt)
      g.fillStyle = color
      const w = h * 0.42
      g.beginPath()
      g.roundRect(-w / 2, -h / 2, w, h, w / 2)
      g.fill()
      g.restore()
    }
    const blob = (path: () => void, color: string, ex: number, ey: number, eh: number, tilt = -0.25) => {
      g.fillStyle = color
      g.beginPath()
      path()
      g.fill()
      eye(ex - eh * 0.42, ey, eh, tilt)
      eye(ex + eh * 0.42, ey - eh * 0.12, eh, tilt)
    }
    const circle = (x: number, y: number, rr: number) => () => g.arc(x, y, rr, 0, Math.PI * 2)
    const rr = (x: number, y: number, w: number, h: number, k: number, rot = 0) => () => {
      g.save()
      g.translate(x, y)
      g.rotate(rot)
      g.roundRect(-w / 2, -h / 2, w, h, k)
      g.restore()
    }
    blob(circle(260, 300, 110), '#0b0b0b', 280, 270, 58)
    blob(rr(470, 300, 200, 190, 70, 0.08), '#13b8a6', 470, 300, 70, 0)
    blob(rr(690, 200, 190, 160, 60, -0.3), '#9b5cff', 690, 220, 40)
    blob(rr(820, 400, 200, 190, 60, 0.15), '#1683ff', 810, 400, 40, 0)
    blob(circle(200, 520, 120), '#ff6a00', 200, 470, 64, 0.5)
    blob(() => { g.arc(400, 540, 90, 0, Math.PI * 2); g.arc(470, 500, 80, 0, Math.PI * 2); g.arc(530, 560, 80, 0, Math.PI * 2) }, '#ff9a00', 450, 540, 64, 0)
    blob(() => { g.moveTo(690, 360); g.quadraticCurveTo(820, 640, 770, 650); g.lineTo(600, 650); g.quadraticCurveTo(560, 640, 690, 360) }, '#ff2e9a', 690, 520, 40, 0)
    blob(circle(920, 590, 105), '#9a6a3f', 930, 560, 70, -0.5)
  })
}

// A note stuck to his monitor. Every desk has one.
export function stickyNote() {
  return canvas(256, 256, (g) => {
    g.fillStyle = '#ffe680'
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = 'rgba(0,0,0,0.06)'
    g.fillRect(0, 0, 256, 34)
    g.fillStyle = '#2a2a2a'
    g.font = '500 26px "Geist Mono", monospace'
    ;['rule 1:', 'dont ape', '', 'rule 2:', 'see rule 1'].forEach((l, i) => g.fillText(l, 22, 74 + i * 34))
  })
}

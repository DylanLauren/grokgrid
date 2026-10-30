// Redraws a saved page of the real site (scripts/snapshot.js) as live DOM inside a shadow root,
// with the site's own stylesheet, so every card, number and chart can be animated on its own.
window.siteUI = async function (host, name, base) {
  const snap = await (await fetch(`${base}/${name}.json`)).json()
  const root = host.attachShadow({ mode: 'open' })
  const css = snap.css
    .replace(/:root/g, ':host')
    .replace(/(^|[\s,}])html(?=[\s,{.:\[])/g, '$1:host')
    .replace(/(^|[\s,}])body(?=[\s,{.:\[])/g, '$1.gg-body')
  root.innerHTML = `<style>${css}
    :host { display: block; position: relative; overflow: hidden; contain: layout paint; width: ${snap.vw}px; height: ${snap.vh}px; background: var(--ink, #0a0a0a); }
    .gg-body { position: absolute; inset: 0; margin: 0; overflow: hidden; }
  </style><div class="gg-body ${snap.bodyClass}"><div id="root">${snap.html}</div></div>`
  host._snap = snap
  return root
}

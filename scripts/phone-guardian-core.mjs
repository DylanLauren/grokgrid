// Pure rules for the phone guardian (scripts/phone-guardian.mjs). The site's phone is one pinned
// Chrome window showing the house wallet's pump.fun profile. The feed refuses, by design, any
// window that is full screen, resized, or on another page, and then waits for an operator.
// The guardian puts that one window back and resumes the feed only after those refusals.

export const DEFAULT_GUARDIAN = Object.freeze({ bounds: { x: 10, y: 40, width: 406, height: 851 } });

// Supervisor stop reasons the guardian may clear once the window is put back. Credential,
// identity and request failures stay with the operator.
export const FIXABLE = new Set(['phone-window-geometry-invalid', 'browser-viewport-invalid', 'browser-url-mismatch', 'window-changed-during-capture']);

/** What to do to the window. `w` is { fullScreen, bounds, url } as read from Chrome. */
export function windowFixes(w, browserUrl, bounds) {
  const fixes = [];
  if (!w) return fixes;
  if (w.fullScreen === true) fixes.push('exit-full-screen');
  // Only a page inside the pinned profile (a tab or query the viewer clicked) is put back.
  if (typeof w.url === 'string' && w.url !== browserUrl && w.url.startsWith(browserUrl)) fixes.push('reset-url');
  const b = w.bounds;
  if (!b || ['x', 'y', 'width', 'height'].some(k => Math.abs(b[k] - bounds[k]) > 2)) fixes.push('restore-bounds');
  return fixes;
}

// Hides the page scrollbar in the captured window. Idempotent; a reload drops it and the next
// run puts it back. Style only: it reads nothing from the page.
export const HIDE_SCROLLBAR_JS = "(()=>{if(!document.getElementById('gg-noscroll')){const s=document.createElement('style');s.id='gg-noscroll';s.textContent='html,body{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';(document.head||document.documentElement).appendChild(s)}return 'ok'})()";

/** Resume only a feed the supervisor stopped for a window problem, never a manual pause. */
export function shouldResume({ pausedFile, appState, supervisorState, supervisorReason }) {
  return pausedFile === true && appState === 'supervisor-stopped-review-required' && supervisorState === 'stopped-needs-operator' && FIXABLE.has(supervisorReason);
}

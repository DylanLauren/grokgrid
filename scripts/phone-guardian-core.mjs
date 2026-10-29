// Pure rules for the phone guardian (scripts/phone-guardian.mjs). The site's phone is one pinned
// Chrome window showing the house wallet's pump.fun profile. The feed refuses, by design, any
// window that is full screen, resized, or on another page, and then waits for an operator.
// The guardian puts that one window back and resumes the feed only after those refusals.

export const DEFAULT_GUARDIAN = Object.freeze({ bounds: { x: 10, y: 40, width: 406, height: 851 } });

// Supervisor stop reasons the guardian may clear once the window is put back. Credential,
// identity and request failures stay with the operator.
export const FIXABLE = new Set(['phone-window-geometry-invalid', 'browser-viewport-invalid', 'browser-url-mismatch', 'window-changed-during-capture']);

/**
 * What to do to the window. `w` is { fullScreen, bounds, url } as read from Chrome; `target` is
 * the page it should show (the house profile, or the coin the house is trading). It only moves
 * between pump.fun pages: a window on any other site is left alone.
 */
export function windowFixes(w, browserUrl, bounds, target = browserUrl) {
  const fixes = [];
  if (!w) return fixes;
  if (w.fullScreen === true) fixes.push('exit-full-screen');
  if (typeof w.url === 'string' && w.url !== target && w.url.startsWith('https://pump.fun/')) fixes.push('show-target');
  const b = w.bounds;
  if (!b || ['x', 'y', 'width', 'height'].some(k => Math.abs(b[k] - bounds[k]) > 2)) fixes.push('restore-bounds');
  return fixes;
}

// Hides the page scrollbar in the captured window. The style sits on <html> (the page re-renders
// <head>) and an observer puts it back if it is removed; a full reload drops both and the next
// run re-applies them. Style only: it reads nothing from the page.
export const HIDE_SCROLLBAR_JS = "(()=>{const css='html,body{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';const put=()=>{if(!document.getElementById('gg-noscroll')){const s=document.createElement('style');s.id='gg-noscroll';s.textContent=css;document.documentElement.appendChild(s)}};put();if(!window.__ggNoScroll){window.__ggNoScroll=new MutationObserver(put);window.__ggNoScroll.observe(document.documentElement,{childList:true,subtree:true})}return 'ok'})()";

/** Resume only a feed the supervisor stopped for a window problem, never a manual pause. */
export function shouldResume({ pausedFile, appState, supervisorState, supervisorReason }) {
  return pausedFile === true && appState === 'supervisor-stopped-review-required' && supervisorState === 'stopped-needs-operator' && FIXABLE.has(supervisorReason);
}

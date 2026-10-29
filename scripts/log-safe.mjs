// Error text safe for log files: provider URLs carry API keys in their query string, so every
// URL is cut to its origin, any api-key / token parameter is removed, and the text is capped.
export function safeError(e, max = 160) {
  return String(e?.message || e)
    .replace(/https?:\/\/[^\s"'<>)]+/g, u => { try { return new URL(u).origin; } catch { return '[url]'; } })
    .replace(/(api[-_]?key|token|secret|authorization)[=:]\s*[^\s&"']+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

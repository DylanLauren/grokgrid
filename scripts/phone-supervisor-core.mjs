// Pure restart/recovery policy. No capture, credentials, process signals or file IO.
const terminal = new Set(['credential-rejected', 'request-rejected', 'window-identity-mismatch', 'browser-url-mismatch', 'phone-window-geometry-invalid', 'window-changed-during-capture'])
export function decidePhoneRestart({ exitCode, signal, status, restarts = 0 }) {
  if (!Number.isSafeInteger(restarts) || restarts < 0) return { action: 'stop', reason: 'invalid-restart-state' }
  if (signal === 'SIGTERM' || signal === 'SIGINT' || status?.state === 'stopped') return { action: 'stop', reason: 'publisher-stopped' }
  const reason = typeof status?.reason === 'string' ? status.reason : ''
  if (terminal.has(reason)) return { action: 'stop', reason }
  if (reason === 'screen-credential-invalid-or-expiring') return { action: 'wait-renewal', reason }
  if (exitCode === 0) return { action: 'stop', reason: 'publisher-completed' }
  if (restarts >= 5) return { action: 'stop', reason: 'restart-budget-exhausted' }
  return { action: 'restart', reason: 'publisher-unavailable', delayMs: Math.min(300_000, 60_000 * 2 ** restarts) }
}
export function planPhoneLockRecovery({ contents, metadata, expectedUid, processState }) {
  if (!metadata || metadata.isFile !== true || metadata.isSymbolicLink !== false || metadata.uid !== expectedUid || !Number.isSafeInteger(metadata.mode) || (metadata.mode & 0o077) !== 0 || metadata.nlink !== 1 || !Number.isSafeInteger(metadata.dev) || !Number.isSafeInteger(metadata.ino) || typeof contents !== 'string' || !/^[1-9]\d{0,9}\n?$/.test(contents)) return { action: 'hold', reason: 'lock-unverifiable' }
  const pid = Number(contents.trim())
  if (!Number.isSafeInteger(pid) || pid <= 0) return { action: 'hold', reason: 'lock-unverifiable' }
  // Only an ESRCH result qualifies as dead. EPERM, errors, PID reuse and an
  // existing live process all hold. The IO adapter must check again before unlink.
  if (processState !== 'dead') return { action: 'hold', reason: processState === 'alive' ? 'lock-owner-alive' : 'lock-owner-unknown' }
  return { action: 'remove-lock', pid, expected: { dev: metadata.dev, ino: metadata.ino, contents } }
}

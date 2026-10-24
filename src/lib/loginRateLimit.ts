const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCKOUT_MS = 5 * 60 * 1000

type Entry = {
  count: number
  windowStart: number
  lockedUntil: number
}

const entries = new Map<string, Entry>()

function prune(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.lockedUntil > now) continue
    if (now - entry.windowStart > WINDOW_MS) entries.delete(key)
  }
}

export function checkLoginRateLimit(
  key: string,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now()
  prune(now)
  const entry = entries.get(key)
  if (!entry) return { ok: true }
  if (entry.lockedUntil > now) {
    return { ok: false, retryAfterMs: entry.lockedUntil - now }
  }
  if (now - entry.windowStart > WINDOW_MS) {
    entries.delete(key)
    return { ok: true }
  }
  return { ok: true }
}

export function recordLoginFailure(key: string): void {
  const now = Date.now()
  prune(now)
  const prev = entries.get(key)
  if (!prev || now - prev.windowStart > WINDOW_MS) {
    entries.set(key, { count: 1, windowStart: now, lockedUntil: 0 })
    return
  }
  const count = prev.count + 1
  const lockedUntil =
    count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : prev.lockedUntil
  entries.set(key, { count, windowStart: prev.windowStart, lockedUntil })
}

export function recordLoginSuccess(key: string): void {
  entries.delete(key)
}

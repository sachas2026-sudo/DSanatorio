export function formatPersistError(err: unknown, context: string): string {
  const detail =
    err instanceof Error ? err.message.trim() : String(err ?? '').trim()
  return detail ? `${context}: ${detail}` : `${context}.`
}

/** Mensaje para diálogos cuando falla una operación async. */
export function formatAppError(err: unknown, fallback: string): string {
  const detail =
    err instanceof Error ? err.message.trim() : String(err ?? '').trim()
  return detail || fallback
}

export function logAppError(context: string, err: unknown): void {
  console.error(context, err)
}

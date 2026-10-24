export function buildEntityMap<T extends { id: string }>(
  items: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    map.set(item.id, item)
  }
  return map
}

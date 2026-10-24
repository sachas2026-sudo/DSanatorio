export function ok(data, meta = undefined) {
  return meta === undefined ? { data } : { data, meta };
}

export function fail(code, message, details = undefined) {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

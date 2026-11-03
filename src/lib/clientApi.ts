import { invoke } from '@tauri-apps/api/core'

export type ApiReply<T = unknown> = {
  status: number
  body: T
}

/** Llama a la API del servidor en modo cliente (el token vive en Rust). */
export async function clientApi<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiReply<T>> {
  return invoke<ApiReply<T>>('client_api', {
    method,
    path,
    body: body ?? null,
  })
}

export function clientApiErrorMessage(reply: ApiReply): string {
  const body = reply.body
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const message = record.message ?? record.error
    if (typeof message === 'string' && message.trim()) return message
  }
  return `El servidor respondió con error ${reply.status}`
}

/** Lanza un Error legible si la respuesta no es 2xx. */
export function ensureApiOk(reply: ApiReply): void {
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error(clientApiErrorMessage(reply))
  }
}

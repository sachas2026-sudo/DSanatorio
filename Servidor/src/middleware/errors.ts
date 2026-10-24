import type { FastifyInstance } from 'fastify'

type RequestError = Error & { statusCode?: number; validation?: unknown[] }

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: RequestError, request, reply) => {
    request.log.error(error)
    const validation = Array.isArray(error.validation)
    const statusCode = validation ? 400 : error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500
    reply.status(statusCode).send({ error: {
      code: validation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
      message: statusCode === 500 ? 'Error interno del servidor' : error.message,
      ...(validation ? { details: error.validation } : {}),
    } })
  })
  app.setNotFoundHandler((request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${request.method} ${request.url}` } }))
}
import type { FastifyInstance, FastifySchema } from 'fastify'
import { healthResponseSchema } from '../schemas/health.js'
import type { createHealthService } from '../services/health.js'

const schema = { response: { 200: healthResponseSchema } } as unknown as FastifySchema
export async function registerHealthRoute(app: FastifyInstance, { healthService }: { healthService: ReturnType<typeof createHealthService> }): Promise<void> {
  app.get('/health', { schema }, async () => healthService.getStatus())
}
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServerConfig } from './config/config.js'
import type { DatabaseHandle } from './database/database.js'
import { registerErrorHandling } from './middleware/errors.js'
import { corsOptions } from './plugins/cors.js'
import { createHealthRepository } from './repositories/health.js'
import { registerRoutes } from './routes/index.js'
import { createHealthService } from './services/health.js'
import { zodSerializerCompiler, zodValidatorCompiler } from './validators/zod.js'

export function buildApp(config: ServerConfig, db: DatabaseHandle): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel } })
  const healthService = createHealthService(createHealthRepository(db), config.version)
  app.setValidatorCompiler(zodValidatorCompiler)
  app.setSerializerCompiler(zodSerializerCompiler)
  void app.register(cors, corsOptions(config))
  void app.register(registerRoutes, { prefix: config.apiPrefix, healthService })
  registerErrorHandling(app)
  app.addHook('onClose', async () => db.close())
  return app
}
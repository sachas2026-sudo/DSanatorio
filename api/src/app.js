import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { config } from './config/index.js';
import { openDatabase } from './repositories/database.js';
import { createHealthRepository } from './repositories/health.repository.js';
import { createHealthService } from './services/health.service.js';
import { createHealthController } from './controllers/health.controller.js';
import { registerRoutes } from './routes/index.js';
import { registerErrorHandler } from './middlewares/error-handler.js';

export function buildApp({ databasePath = config.databasePath } = {}) {
  const app = Fastify({ logger: true, ajv: { customOptions: { coerceTypes: false } } });
  const db = openDatabase(databasePath);
  const healthRepository = createHealthRepository(db);
  const healthService = createHealthService({ healthRepository });
  const controller = createHealthController({ healthService, version: config.version });

  app.register(sensible);
  app.register(registerRoutes, { prefix: config.apiPrefix, controller });
  registerErrorHandler(app);
  app.addHook('onClose', async () => db.close());
  return app;
}

import { healthRoutes } from './health.routes.js';

export async function registerRoutes(app, dependencies) {
  await app.register(healthRoutes, dependencies);
}

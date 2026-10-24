import { emptyParamsSchema } from '../schemas/base.js';

export async function healthRoutes(app, { controller }) {
  app.get('/health', { schema: { params: emptyParamsSchema } }, controller.health);
  app.get('/version', { schema: { params: emptyParamsSchema } }, controller.version);
}

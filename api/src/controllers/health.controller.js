import { ok } from '../utils/http.js';

export function createHealthController({ healthService, version }) {
  return {
    health: async (_request, reply) => reply.send(ok(healthService.health())),
    version: async (_request, reply) => reply.send(ok(healthService.version(version)))
  };
}

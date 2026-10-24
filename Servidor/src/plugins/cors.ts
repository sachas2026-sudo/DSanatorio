import type { FastifyCorsOptions } from '@fastify/cors'
import type { ServerConfig } from '../config/config.js'

export function corsOptions(config: ServerConfig): FastifyCorsOptions {
  return { origin: config.corsOrigin === '*' ? true : config.corsOrigin }
}
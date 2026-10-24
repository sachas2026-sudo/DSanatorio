import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { createHealthService } from '../services/health.js'

export type RouteDependencies = { healthService: ReturnType<typeof createHealthService> }
type RouteRegistration = (app: FastifyInstance, dependencies: RouteDependencies) => Promise<void>

export async function registerRoutes(app: FastifyInstance, dependencies: RouteDependencies): Promise<void> {
  const directory = fileURLToPath(new URL('.', import.meta.url))
  const files = (await readdir(directory)).filter(file => file !== 'index.js' && file !== 'index.ts').filter(file => file.endsWith('.js') || file.endsWith('.ts')).sort()
  for (const file of files) {
    const routeModule = await import(pathToFileURL(join(directory, file)).href) as Record<string, unknown>
    for (const candidate of Object.values(routeModule)) {
      if (typeof candidate === 'function' && candidate.name.startsWith('register')) await (candidate as RouteRegistration)(app, dependencies)
    }
  }
}
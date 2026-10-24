import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const config = {
  host: process.env.API_HOST ?? '127.0.0.1',
  port: Number(process.env.API_PORT ?? 3001),
  apiPrefix: '/api/v1',
  version: process.env.APP_VERSION ?? '3.0.0',
  databasePath: process.env.SQLITE_PATH ?? path.join(root, 'data', 'sanatorio.sqlite')
};

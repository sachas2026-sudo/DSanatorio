import { fail } from '../utils/http.js';

export function registerErrorHandler(app) {
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.validation ? 400 : (error.statusCode >= 400 ? error.statusCode : 500);
    const code = error.validation ? 'VALIDATION_ERROR' : (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR');
    reply.status(statusCode).send(fail(code, statusCode === 500 ? 'Internal server error' : error.message));
  });
}

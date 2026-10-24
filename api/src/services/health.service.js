export function createHealthService({ healthRepository }) {
  return {
    health() {
      return { status: 'ok', database: healthRepository.checkDatabase() ? 'connected' : 'disconnected' };
    },
    version(version) {
      return { version };
    }
  };
}

export function createHealthRepository(db) {
  return {
    checkDatabase() {
      return db.prepare('SELECT 1 AS connected').get().connected === 1;
    }
  };
}

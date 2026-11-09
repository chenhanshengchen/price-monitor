const config = require('../config');

function cleanupOldData(db) {
  const retentionDays = config.dataRetentionDays || 3;

  const countBefore = db.prepare('SELECT COUNT(*) as count FROM price_history').get();

  const result = db.prepare(`
    DELETE FROM price_history
    WHERE datetime(record_time) < datetime('now', '-' || ? || ' days', 'localtime')
  `).run(retentionDays);

  const countAfter = db.prepare('SELECT COUNT(*) as count FROM price_history').get();
  const deletedCount = countBefore.count - countAfter.count;

  return {
    deleted: deletedCount,
    remaining: countAfter.count,
    retentionDays: retentionDays
  };
}

module.exports = { cleanupOldData };

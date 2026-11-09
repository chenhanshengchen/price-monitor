const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function manualCleanup() {
  try {
    const SQL = await initSqlJs();
    const dbPath = path.resolve(__dirname, '..', config.paths.database);
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    const retentionDays = config.dataRetentionDays || 3;

    const latestRecord = db.exec('SELECT MAX(record_time) as latest FROM price_history');
    if (!latestRecord || !latestRecord[0] || !latestRecord[0].values[0][0]) {
      console.log('数据库为空,无需清理');
      db.close();
      return { deleted: 0, remaining: 0, retentionDays };
    }

    const cutoffTime = latestRecord[0].values[0][0];
    console.log(`最新记录时间: ${cutoffTime}`);
    console.log(`保留天数: ${retentionDays} 天`);

    const countBefore = db.exec('SELECT COUNT(*) as count FROM price_history');
    const totalBefore = countBefore[0].values[0][0];
    console.log(`清理前总记录数: ${totalBefore}`);

    const cutoffQuery = `SELECT datetime('${cutoffTime}', '-${retentionDays} days') as cutoff`;
    const cutoffResult = db.exec(cutoffQuery);
    const cutoffDatetime = cutoffResult[0].values[0][0];
    console.log(`清理截止时间: ${cutoffDatetime}`);

    const toDeleteQuery = `SELECT COUNT(*) as count FROM price_history WHERE datetime(record_time) < datetime('${cutoffTime}', '-${retentionDays} days')`;
    const toDeleteResult = db.exec(toDeleteQuery);
    const toDelete = toDeleteResult[0].values[0][0];
    console.log(`即将删除 ${toDelete} 条记录`);

    if (toDelete === 0) {
      console.log('无需删除数据');
      db.close();
      return { deleted: 0, remaining: totalBefore, retentionDays };
    }

    db.run(`DELETE FROM price_history WHERE datetime(record_time) < datetime('${cutoffTime}', '-${retentionDays} days')`);

    const countAfter = db.exec('SELECT COUNT(*) as count FROM price_history');
    const totalAfter = countAfter[0].values[0][0];
    const deletedCount = totalBefore - totalAfter;

    console.log(`清理后总记录数: ${totalAfter}`);
    console.log(`实际删除: ${deletedCount} 条记录`);

    const newBuffer = db.export();
    fs.writeFileSync(dbPath, newBuffer);

    db.close();

    return {
      deleted: deletedCount,
      remaining: totalAfter,
      retentionDays,
      cutoffTime,
      cutoffDatetime
    };
  } catch (error) {
    console.error('清理失败:', error.message);
    throw error;
  }
}

if (require.main === module) {
  manualCleanup()
    .then(result => {
      console.log('\n=== 清理完成 ===');
      console.log(`删除记录数: ${result.deleted}`);
      console.log(`保留记录数: ${result.remaining}`);
      console.log(`保留天数: ${result.retentionDays}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('执行失败:', error);
      process.exit(1);
    });
}

module.exports = { manualCleanup };
